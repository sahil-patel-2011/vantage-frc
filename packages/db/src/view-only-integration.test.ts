/**
 * 0715_view_only_read_only.sql against a real PostgreSQL, on the vantage_app role.
 *
 * Proves the promise Team admin › Access makes ("View only — Can look, can't
 * change."): a viewer is refused INSERT/UPDATE/DELETE on team data (scouting,
 * tasks, todos, calendar, chat, inventory, CAD, notebook), still writes their own
 * state on every exempt table, and an owner, admin or team member is unaffected.
 * Also the guard that keeps it true: every org-scoped table is either guarded or
 * exempt with a reason, so a future table cannot silently reopen the hole.
 *
 * Runs only when TEST_DATABASE_ADMIN_URL names a local database whose name has a
 * test/ci segment (same guard as postgres-integration.test.ts). Migrations are
 * applied idempotently first; fixtures live in rolled-back transactions, except
 * the withRls error-path check, which deletes what it created.
 */
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { VIEW_ONLY_MESSAGE, ViewOnlyError, explainWriteRefusal, isViewOnlyRefusal } from "./view-only";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

type Outcome = { ok: boolean; rowCount: number; code: string; detail: string; message: string };

function assertSafeTestDatabase(connectionString: string): void {
  const target = new URL(connectionString);
  const database = decodeURIComponent(target.pathname.slice(1));
  const local = ["localhost", "127.0.0.1", "::1"].includes(target.hostname);
  if (process.env.NODE_ENV === "production" || !local || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(database)) {
    throw new Error("Dedicated local test database required (name with a test/ci segment).");
  }
}

suite("View only is read-only (0715) in PostgreSQL", () => {
  let client: pg.Client;

  beforeAll(async () => {
    assertSafeTestDatabase(url!);
    // Idempotent: applies anything missing (all of it on an empty database), else SKIPs.
    execFileSync(process.execPath, ["scripts/run-migrations.mjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, DATABASE_ADMIN_URL: url, DATABASE_URL_UNPOOLED: "", POSTGRES_URL_NON_POOLING: "", DATABASE_URL: "", POSTGRES_URL: "" },
      maxBuffer: 8 * 1024 * 1024,
    });
    client = new pg.Client({ connectionString: url });
    await client.connect();
  }, 600_000);

  afterAll(async () => {
    await client?.end();
  });

  /** Act as a person on vantage_app, or (null) as the migration superuser. */
  async function actAs(userId: string | null, role = "vantage_app") {
    await client.query("RESET ROLE");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
    if (userId) await client.query(`SET LOCAL ROLE ${role}`);
  }

  async function attempt(userId: string, sql: string, params: unknown[] = [], role = "vantage_app"): Promise<Outcome> {
    await actAs(userId, role);
    await client.query("SAVEPOINT attempt");
    try {
      const result = await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT attempt");
      return { ok: (result.rowCount ?? 0) > 0, rowCount: result.rowCount ?? 0, code: "", detail: "", message: "" };
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT attempt");
      const pgError = error as { code?: string; detail?: string; message?: string };
      return { ok: false, rowCount: 0, code: pgError.code ?? "", detail: pgError.detail ?? "", message: pgError.message ?? "" };
    } finally {
      await actAs(null);
    }
  }

  async function asSuper<T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) {
    await actAs(null);
    return client.query<T>(sql, params);
  }

  async function seedTeam() {
    const org = randomUUID();
    const people = { owner: randomUUID(), admin: randomUUID(), scout: randomUUID(), viewer: randomUUID() };
    for (const [role, id] of Object.entries(people)) {
      await asSuper("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [id, `${id}@example.test`, role]);
      await asSuper("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [id]);
    }
    await asSuper("INSERT INTO organizations(id,slug,name,team_number) VALUES($1::uuid,$2,'View only fixture',9715)", [org, org]);
    for (const [role, id] of Object.entries(people)) {
      await asSuper("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3::org_role)", [org, id, role]);
    }
    return { org, people };
  }

  it("guards every org-scoped table that is not exempt, and nothing else", async () => {
    const coverage = await asSuper<{ table_name: string; exempt: boolean; guarded: boolean; reason: string | null }>(
      "SELECT table_name, exempt, guarded, reason FROM view_only_guard_coverage ORDER BY table_name",
    );
    expect(coverage.rows.length).toBeGreaterThan(500);
    const unguarded = coverage.rows.filter((row) => !row.exempt && !row.guarded).map((row) => row.table_name);
    expect(unguarded, "org-scoped tables a viewer could write: guard them (SELECT install_view_only_guards()) or exempt them with a reason").toEqual([]);
    expect(coverage.rows.filter((row) => row.exempt && row.guarded).map((row) => row.table_name)).toEqual([]);
    for (const row of coverage.rows.filter((r) => r.exempt)) expect((row.reason ?? "").length, row.table_name).toBeGreaterThanOrEqual(12);

    // Every exemption names a real org-scoped table (no stale rows hiding a rename).
    const stale = await asSuper<{ table_name: string }>(
      `SELECT e.table_name FROM view_only_exempt_tables e
        WHERE NOT EXISTS (SELECT 1 FROM view_only_guard_coverage c WHERE c.table_name = e.table_name)`,
    );
    expect(stale.rows).toEqual([]);

    // The guard applies to the request role only; jobs and service roles are untouched.
    const roles = await asSuper<{ roles: string }>(
      `SELECT DISTINCT array_to_string(ARRAY(SELECT rolname FROM pg_roles WHERE oid = ANY(polroles) ORDER BY 1), ',') AS roles
         FROM pg_policy WHERE polname LIKE 'view_only_%'`,
    );
    expect(roles.rows).toEqual([{ roles: "vantage_app" }]);

    // Re-running the installer is a no-op.
    expect((await asSuper<{ changed: number }>("SELECT install_view_only_guards() AS changed")).rows[0]?.changed).toBe(0);

    // On exempt tables the only view-only rules left are the narrower membership and Ask AI ones.
    const exemptRestrictions = await asSuper<{ table_name: string; polname: string }>(
      `SELECT c.relname AS table_name, p.polname
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
         JOIN view_only_exempt_tables e ON e.table_name = c.relname
        WHERE NOT p.polpermissive
          AND (coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
              ~ '(refuse_view_only_write|is_org_viewer)'
        ORDER BY 1, 2`,
    );
    expect(exemptRestrictions.rows).toEqual([
      { table_name: "agent_messages", polname: "view_only_unshared_message_insert" },
      { table_name: "agent_messages", polname: "view_only_unshared_message_update" },
      { table_name: "agent_threads", polname: "view_only_private_thread_insert" },
      { table_name: "agent_threads", polname: "view_only_private_thread_update" },
      { table_name: "memberships", polname: "view_only_membership_insert" },
      { table_name: "memberships", polname: "view_only_membership_update" },
    ]);
  });

  it("refuses a viewer's team-data writes and leaves owners, admins and team members alone", async () => {
    await client.query("BEGIN");
    try {
      const { org, people } = await seedTeam();
      for (const [role, id] of Object.entries(people)) {
        const viewer = await asSuper<{ value: boolean }>(
          "SELECT set_config('app.user_id', $1, true), is_org_viewer($2::uuid) AS value",
          [id, org],
        );
        expect(viewer.rows[0]?.value, role).toBe(role === "viewer");
      }
      await asSuper("SELECT set_config('app.user_id', '', true)");

      const schema = (
        await asSuper<{ id: string }>(
          `INSERT INTO scout_schemas(org_id,year,type,version,schema,created_by)
           VALUES($1,2026,'match',1,'{}'::jsonb,$2) RETURNING id`,
          [org, people.owner],
        )
      ).rows[0]!.id;
      const pitSchema = (
        await asSuper<{ id: string }>(
          `INSERT INTO scout_schemas(org_id,year,type,version,schema,created_by)
           VALUES($1,2026,'pit',1,'{}'::jsonb,$2) RETURNING id`,
          [org, people.owner],
        )
      ).rows[0]!.id;
      const channel = (
        await asSuper<{ id: string }>(
          `INSERT INTO org_conversations(org_id,kind,title,created_by) VALUES($1,'team','Team',$2) RETURNING id`,
          [org, people.owner],
        )
      ).rows[0]!.id;
      // Reference rows the scouting entries point at (rolled back with everything else).
      await asSuper(
        `INSERT INTO events_ref(event_key,year,name) VALUES('2026vo715',2026,'View only fixture') ON CONFLICT DO NOTHING`,
      );
      await asSuper(
        `INSERT INTO teams_ref(team_key,team_number,name)
         SELECT 'frc' || (97150 + g), 97150 + g, 'Fixture ' || g FROM generate_series(0, 60) g
         ON CONFLICT DO NOTHING`,
      );
      await asSuper(
        `INSERT INTO matches_ref(match_key,event_key,comp_level,set_number,match_number,red_alliance,blue_alliance)
         SELECT '2026vo715_qm' || g, '2026vo715', 'qm', 1, g, '[]'::jsonb, '[]'::jsonb FROM generate_series(0, 60) g
         ON CONFLICT DO NOTHING`,
      );

      type Case = {
        table: string;
        insert: (userId: string, n: number) => [string, unknown[]];
        /** Columns for an UPDATE that any member may make (the row's own author for author-only tables). */
        update: string;
        /** False where no request role may hard-delete (chat keeps history; authors soft-delete). */
        ownerDeletes?: boolean;
      };
      const cases: Case[] = [
        {
          table: "match_scout_entries",
          insert: (u, n) => [
            `INSERT INTO match_scout_entries(org_id,event_key,match_key,team_key,scout_user_id,schema_id,payload,client_id)
             VALUES($1,'2026vo715',$4,'frc97150',$2,$3,'{}'::jsonb,$5) RETURNING id`,
            [org, u, schema, `2026vo715_qm${n}`, randomUUID()],
          ],
          update: "payload = '{\"note\":1}'::jsonb",
        },
        {
          table: "pit_scout_entries",
          insert: (u, n) => [
            `INSERT INTO pit_scout_entries(org_id,event_key,team_key,scout_user_id,schema_id,payload,client_id)
             VALUES($1,'2026vo715',$4,$2,$3,'{}'::jsonb,$5) RETURNING id`,
            [org, u, pitSchema, `frc${97150 + n}`, randomUUID()],
          ],
          update: "payload = '{\"note\":1}'::jsonb",
        },
        {
          table: "build_tasks",
          insert: (u) => [`INSERT INTO build_tasks(org_id,title,season_year,created_by) VALUES($1,'Intake',2026,$2) RETURNING id`, [org, u]],
          update: "title = 'Intake v2'",
        },
        {
          table: "team_todos",
          insert: (u) => [`INSERT INTO team_todos(org_id,title,created_by) VALUES($1,'Order bolts',$2) RETURNING id`, [org, u]],
          update: "title = 'Order nuts'",
        },
        {
          table: "subteam_calendar_events",
          insert: (u) => [
            `INSERT INTO subteam_calendar_events(org_id,title,starts_at,created_by) VALUES($1,'Build night',now(),$2) RETURNING id`,
            [org, u],
          ],
          update: "title = 'Build night (late)'",
        },
        {
          table: "org_messages",
          insert: (u) => [
            `INSERT INTO org_messages(conversation_id,org_id,author_user_id,body) VALUES($1,$2,$3,'hello') RETURNING id`,
            [channel, org, u],
          ],
          update: "deleted_at = now()",
          ownerDeletes: false,
        },
        {
          table: "inventory_items",
          insert: (u) => [`INSERT INTO inventory_items(org_id,name,created_by) VALUES($1,'NEO',$2) RETURNING id`, [org, u]],
          update: "name = 'NEO 550'",
        },
        {
          table: "cad_documents",
          insert: (u, n) => [`INSERT INTO cad_documents(org_id,season_year,title,created_by) VALUES($1,2026,$3,$2) RETURNING id`, [org, u, `Drivebase ${n}`]],
          update: "title = title || ' v2'",
        },
        {
          table: "notebook_entries",
          insert: (u) => [
            `INSERT INTO notebook_entries(org_id,season_year,entry_date,title,author_user_id) VALUES($1,2026,current_date,'Day 1',$2) RETURNING id`,
            [org, u],
          ],
          update: "title = 'Day one'",
        },
      ];

      let n = 0;
      for (const testCase of cases) {
        // The viewer cannot add a row, even one "authored" by themselves…
        n += 1;
        const [viewerInsert, viewerParams] = testCase.insert(people.viewer, n);
        const refused = await attempt(people.viewer, viewerInsert, viewerParams);
        expect(refused.ok, `viewer inserts ${testCase.table}`).toBe(false);
        expect(refused.code, `viewer inserts ${testCase.table}`).toBe("42501");

        // …while owner, admin and team member can, and edit what they wrote.
        for (const who of ["owner", "admin", "scout"] as const) {
          n += 1;
          const [sql, params] = testCase.insert(people[who], n);
          const inserted = await attempt(people[who], sql, params);
          expect(inserted.ok, `${who} inserts ${testCase.table}: ${inserted.message}`).toBe(true);
        }

        // A row the team member wrote: the viewer cannot change or delete it.
        n += 1;
        const [seedSql, seedParams] = testCase.insert(people.scout, n);
        const rowId = (await asSuper<{ id: string }>(seedSql, seedParams)).rows[0]!.id;
        const viewerUpdate = await attempt(people.viewer, `UPDATE ${testCase.table} SET ${testCase.update} WHERE id = $1`, [rowId]);
        expect(viewerUpdate.ok, `viewer updates ${testCase.table}`).toBe(false);
        const viewerDelete = await attempt(people.viewer, `DELETE FROM ${testCase.table} WHERE id = $1`, [rowId]);
        expect(viewerDelete.ok, `viewer deletes ${testCase.table}`).toBe(false);
        const still = await asSuper(`SELECT 1 FROM ${testCase.table} WHERE id = $1`, [rowId]);
        expect(still.rowCount, `${testCase.table} row survives the viewer`).toBe(1);

        const authorUpdate = await attempt(people.scout, `UPDATE ${testCase.table} SET ${testCase.update} WHERE id = $1`, [rowId]);
        expect(authorUpdate.ok, `team member updates own ${testCase.table}: ${authorUpdate.message}`).toBe(true);
        if (testCase.ownerDeletes !== false) {
          const ownerDelete = await attempt(people.owner, `DELETE FROM ${testCase.table} WHERE id = $1`, [rowId]);
          expect(ownerDelete.ok, `owner deletes ${testCase.table}: ${ownerDelete.message}`).toBe(true);
        }
      }

      // The refusal says why, in the product's words, on a table any member may write.
      const why = await attempt(people.viewer, `INSERT INTO build_tasks(org_id,title,season_year,created_by) VALUES($1,'x',2026,$2)`, [org, people.viewer]);
      expect(why).toMatchObject({ code: "42501", detail: "vantage:view_only", message: VIEW_ONLY_MESSAGE });
      expect(isViewOnlyRefusal(why)).toBe(true);

      // A viewer still READS chat.
      await asSuper(`INSERT INTO org_messages(conversation_id,org_id,author_user_id,body) VALUES($1,$2,$3,'read me')`, [channel, org, people.scout]);
      await actAs(people.viewer);
      const visible = await client.query("SELECT body FROM org_messages WHERE conversation_id = $1 AND body = 'read me'", [channel]);
      await actAs(null);
      expect(visible.rowCount).toBe(1);

      // Jobs and SECURITY DEFINER functions are not the request role: unaffected.
      const worker = await attempt(
        people.viewer,
        `INSERT INTO build_tasks(org_id,title,season_year,created_by) VALUES($1,'job',2026,$2)`,
        [org, people.viewer],
        "vantage_worker",
      );
      expect(worker.ok, worker.message).toBe(true);
      await asSuper(
        `CREATE FUNCTION pg_temp.view_only_definer_probe(o uuid, u uuid) RETURNS void
         LANGUAGE sql SECURITY DEFINER AS $$ INSERT INTO build_tasks(org_id,title,season_year,created_by) VALUES(o,'definer',2026,u) $$`,
      );
      const definer = await attempt(people.viewer, "SELECT pg_temp.view_only_definer_probe($1,$2)", [org, people.viewer]);
      expect(definer.message).toBe("");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("still lets a viewer keep their own state on exempt tables", async () => {
    await client.query("BEGIN");
    try {
      const { org, people } = await seedTeam();
      const viewer = people.viewer;
      const ok = async (label: string, sql: string, params: unknown[]) => {
        const outcome = await attempt(viewer, sql, params);
        expect(outcome.ok, `${label}: ${outcome.message}`).toBe(true);
      };

      // Inbox: read and dismiss their notifications.
      const note = (await asSuper<{ id: string }>(
        "INSERT INTO notifications(user_id,org_id,type,payload) VALUES($1,$2,'todo_assigned','{}') RETURNING id",
        [viewer, org],
      )).rows[0]!.id;
      await ok("notifications mark read", "UPDATE notifications SET read_at = now() WHERE id = $1", [note]);
      await ok("notifications dismiss", "DELETE FROM notifications WHERE id = $1", [note]);

      // Own push endpoints and private calendar link.
      await ok("push_subscriptions add", "INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth,org_id) VALUES($1,$2,'k','a',$3)", [viewer, `https://push.example.test/${viewer}`, org]);
      await ok("push_subscriptions remove", "DELETE FROM push_subscriptions WHERE user_id = $1", [viewer]);
      await ok("calendar_feed_tokens", "INSERT INTO calendar_feed_tokens(token,org_id,user_id) VALUES($1,$2,$3)", [randomUUID(), org, viewer]);

      // Settings and preferences.
      await ok("dashboards personal layout", "INSERT INTO dashboards(org_id,name,scope,owner_user_id,created_by) VALUES($1,'Mine','personal',$2,$2)", [org, viewer]);
      await ok("dashboards rename", "UPDATE dashboards SET name = 'Mine 2' WHERE owner_user_id = $1", [viewer]);
      await ok("learning_mode_prefs", "INSERT INTO learning_mode_prefs(org_id,user_id,enabled) VALUES($1,$2,true)", [org, viewer]);
      await ok("learning_mode_prefs toggle", "UPDATE learning_mode_prefs SET enabled = false WHERE user_id = $1", [viewer]);
      await ok("cad_user_preferences", "INSERT INTO cad_user_preferences(org_id,user_id) VALUES($1,$2)", [org, viewer]);
      await ok("scout_voice_user_prefs", "INSERT INTO scout_voice_user_prefs(org_id,user_id) VALUES($1,$2)", [org, viewer]);

      // Onboarding / tour progress.
      await ok("member_onboarding_tracks", "INSERT INTO member_onboarding_tracks(org_id,user_id,track_key,source) VALUES($1,$2,'welcome','welcome')", [org, viewer]);
      await ok(
        "member_onboarding_checks",
        "INSERT INTO member_onboarding_checks(org_id,user_id,track_key,check_key,completed_at,item_key,checked_at) VALUES($1,$2,'welcome','tour',now(),'tour',now())",
        [org, viewer],
      );
      await ok("judge_practice_sessions", "INSERT INTO judge_practice_sessions(org_id,user_id,questions) VALUES($1,$2,'[]'::jsonb)", [org, viewer]);

      // Read receipt on an announcement.
      const announcement = (await asSuper<{ id: string }>(
        "INSERT INTO team_announcements(org_id,title,created_by) VALUES($1,'Bus at 6',$2) RETURNING id",
        [org, people.owner],
      )).rows[0]!.id;
      await ok("announcement_acks", "INSERT INTO announcement_acks(org_id,announcement_id,user_id) VALUES($1,$2,$3)", [org, announcement, viewer]);

      // Feedback to Vantage.
      await ok("support_tickets", "INSERT INTO support_tickets(org_id,user_id,subject,body) VALUES($1,$2,'Help','Please')", [org, viewer]);
      await ok("bug_reports", "INSERT INTO bug_reports(user_id,org_id,description) VALUES($1,$2,'Button')", [viewer, org]);
      await ok("product_events", "INSERT INTO product_events(org_id,user_id,event) VALUES($1,$2,'page_view')", [org, viewer]);

      // Answering a form sent to them.
      const form = (await asSuper<{ id: string }>(
        "INSERT INTO forms(org_id,title,created_by) VALUES($1,'Travel survey',$2) RETURNING id",
        [org, people.owner],
      )).rows[0]!.id;
      await ok("form_responses", "INSERT INTO form_responses(org_id,form_id,respondent_user_id) VALUES($1,$2,$3)", [org, form, viewer]);

      // Reporting a chat message (youth protection).
      const channel = (await asSuper<{ id: string }>(
        "INSERT INTO org_conversations(org_id,kind,title,created_by) VALUES($1,'team','Team',$2) RETURNING id",
        [org, people.owner],
      )).rows[0]!.id;
      const message = (await asSuper<{ id: string }>(
        "INSERT INTO org_messages(conversation_id,org_id,author_user_id,body) VALUES($1,$2,$3,'mean') RETURNING id",
        [channel, org, people.scout],
      )).rows[0]!.id;
      await ok(
        "org_message_reports",
        `INSERT INTO org_message_reports(org_id,message_id,conversation_id,reporter_user_id,message_author_id,reason,body_snapshot)
         VALUES($1,$2,$3,$4,$5,'harassment','mean')`,
        [org, message, channel, viewer, people.scout],
      );

      // Ask AI: private threads and their own metering, never sharing to the team.
      await ok("agent_threads private", "INSERT INTO agent_threads(org_id,created_by,scope,title) VALUES($1,$2,'private','Q')", [org, viewer]);
      const teamThread = await attempt(viewer, "INSERT INTO agent_threads(org_id,created_by,scope,title) VALUES($1,$2,'team','Q')", [org, viewer]);
      expect(teamThread).toMatchObject({ ok: false, code: "42501", message: VIEW_ONLY_MESSAGE });
      // Their own membership: never promote themselves, but leaving stays possible. No self-leave
      // policy exists yet (owners/admins remove people), so prove it with one inside this rollback.
      const promote = await attempt(viewer, "UPDATE memberships SET role = 'admin' WHERE org_id = $1 AND user_id = $2", [org, viewer]);
      expect(promote.ok).toBe(false);
      await asSuper(
        `CREATE POLICY view_only_test_self_leave ON memberships FOR DELETE TO vantage_app
           USING (user_id = current_app_user_id())`,
      );
      await ok("memberships: leave the team", "DELETE FROM memberships WHERE org_id = $1 AND user_id = $2", [org, viewer]);
      await asSuper("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'viewer')", [org, viewer]);

      await ok(
        "ai_usage_events",
        `INSERT INTO ai_usage_events(org_id,user_id,feature,model,provider,key_source,prompt_tokens,completion_tokens,total_tokens,cost_usd,request_id)
         VALUES($1,$2,'chat','m','local','local_cli',1,1,2,0,$3)`,
        [org, viewer, randomUUID()],
      );
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("turns a viewer's refusal into ViewOnlyError after rollback (the withRls error path)", async () => {
    const { org, people } = await (async () => {
      await client.query("BEGIN");
      const seeded = await seedTeam();
      await client.query("COMMIT");
      return seeded;
    })();
    try {
      const refuse = async (userId: string, sql: string, params: unknown[]) => {
        await client.query("BEGIN");
        await actAs(userId);
        try {
          await client.query(sql, params);
          return null;
        } catch (error) {
          return error;
        } finally {
          await client.query("ROLLBACK");
        }
      };
      // Generic RLS refusal on an owner/admin-only table: explained by asking is_org_viewer.
      const invite = `INSERT INTO invites(org_id,email,role,token_hash,invited_by,expires_at)
                      VALUES($1,'new@example.test','scout','h',$2,now() + interval '1 day')`;
      const viewerError = await refuse(people.viewer, invite, [org, people.viewer]);
      expect(viewerError).toBeTruthy();
      const explained = await explainWriteRefusal(client, { userId: people.viewer, orgId: org }, viewerError);
      expect(explained).toBeInstanceOf(ViewOnlyError);
      expect((explained as ViewOnlyError).status).toBe(403);
      // Without an org on the request it still knows a single-team viewer.
      expect(await explainWriteRefusal(client, { userId: people.viewer }, viewerError)).toBeInstanceOf(ViewOnlyError);
      // A team member refused the same way keeps the original error.
      const scoutError = await refuse(people.scout, invite, [org, people.scout]);
      expect(await explainWriteRefusal(client, { userId: people.scout, orgId: org }, scoutError)).toBe(scoutError);
      // The 0715 refusal itself needs no lookup.
      const direct = await refuse(people.viewer, "INSERT INTO team_todos(org_id,title,created_by) VALUES($1,'x',$2)", [org, people.viewer]);
      expect(await explainWriteRefusal(client, { userId: people.viewer, orgId: org }, direct)).toBeInstanceOf(ViewOnlyError);
    } finally {
      await actAs(null);
      await client.query("DELETE FROM organizations WHERE id = $1", [org]);
      await client.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [Object.values(people)]);
    }
  });
});
