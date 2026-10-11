/**
 * 0714_finance_managers.sql against a real PostgreSQL, on the vantage_app role.
 *
 * Proves the role × money matrix the product promises: the team OWNER always
 * manages money; an admin or team member manages money only when the owner
 * chose them ("Manage money" = the manage_budget capability); everyone else may
 * still ASK (purchase requests, their own reimbursement claims, fundraiser
 * events without proceeds); a view-only member writes no money at all.
 *
 * Runs only when TEST_DATABASE_ADMIN_URL names a local database whose name
 * contains "test" (same guard as the other *-integration tests). Everything
 * happens inside one transaction that is rolled back.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;

type Outcome = { ok: boolean; message: string };

suite("finance managers (0714) in PostgreSQL", () => {
  it("lets only the owner and the people the owner chose change money", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.pathname.includes("test")) {
      throw new Error("Dedicated local test database required.");
    }
    const client = new pg.Client({ connectionString: url });
    await client.connect();

    const org = randomUUID();
    const people = {
      owner: randomUUID(),
      admin: randomUUID(),
      adminGranted: randomUUID(),
      scoutGranted: randomUUID(),
      scout: randomUUID(),
      viewer: randomUUID(),
    };
    const roles: Record<keyof typeof people, string> = {
      owner: "owner",
      admin: "admin",
      adminGranted: "admin",
      scoutGranted: "scout",
      scout: "scout",
      viewer: "viewer",
    };

    /** Act as a person on vantage_app, or (null) as the migration superuser. */
    async function actAs(userId: string | null) {
      await client.query("RESET ROLE");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId ?? ""]);
      if (userId) await client.query("SET LOCAL ROLE vantage_app");
    }

    /** Run one statement as someone; ok = it ran AND changed a row. */
    async function attempt(userId: string, sql: string, params: unknown[] = []): Promise<Outcome> {
      await actAs(userId);
      await client.query("SAVEPOINT attempt");
      try {
        const result = await client.query(sql, params);
        await client.query("RELEASE SAVEPOINT attempt");
        return { ok: (result.rowCount ?? 0) > 0, message: "" };
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT attempt");
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      } finally {
        await actAs(null);
      }
    }

    async function scalar<T>(userId: string, sql: string, params: unknown[] = []): Promise<T> {
      await actAs(userId);
      try {
        return (await client.query(sql, params)).rows[0]?.value as T;
      } finally {
        await actAs(null);
      }
    }

    try {
      await client.query("BEGIN");
      for (const [key, id] of Object.entries(people)) {
        await client.query("INSERT INTO users(id,email,name) VALUES($1,$2,$3)", [id, `${id}@example.test`, key]);
        await client.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [id]);
      }
      await client.query("INSERT INTO organizations(id,slug,name) VALUES($1::uuid,$1::text,'Money fixture')", [org]);
      for (const [key, id] of Object.entries(people)) {
        await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,$3::org_role)", [
          org,
          id,
          roles[key as keyof typeof people],
        ]);
      }

      // ---------------------------------------------------------- who may grant
      const grant = (actor: string, grantee: string) =>
        attempt(
          actor,
          `INSERT INTO membership_capabilities(org_id,user_id,capability,granted_by)
           VALUES($1,$2,'manage_budget',$3)`,
          [org, grantee, actor],
        );

      const adminTries = await grant(people.admin, people.scout);
      expect(adminTries.ok, "an admin cannot hand out Manage money").toBe(false);
      expect(adminTries.message).toMatch(/row-level security/);

      expect((await grant(people.owner, people.adminGranted)).ok).toBe(true);
      expect((await grant(people.owner, people.scoutGranted)).ok).toBe(true);

      const grantee = await grant(people.scoutGranted, people.scout);
      expect(grantee.ok, "a granted member cannot pass it on").toBe(false);

      const self = await grant(people.owner, people.owner);
      expect(self.ok, "no self-grant").toBe(false);

      const viewerGrant = await grant(people.owner, people.viewer);
      expect(viewerGrant.ok, "view-only people cannot hold it").toBe(false);
      expect(viewerGrant.message).toMatch(/View-only people can't manage money/);

      // ---------------------------------------------------------- the predicate
      const canManage: Record<string, boolean> = {};
      for (const [key, id] of Object.entries(people)) {
        canManage[key] = await scalar<boolean>(id, "SELECT can_manage_finances($1::uuid) AS value", [org]);
      }
      expect(canManage).toEqual({
        owner: true,
        admin: false,
        adminGranted: true,
        scoutGranted: true,
        scout: false,
        viewer: false,
      });
      // One money permission everywhere: the generic capability check agrees.
      expect(await scalar(people.admin, "SELECT has_org_capability($1::uuid,'manage_budget') AS value", [org])).toBe(false);
      expect(await scalar(people.scoutGranted, "SELECT has_org_capability($1::uuid,'manage_budget') AS value", [org])).toBe(true);
      // ...and the other capabilities keep 0049's behaviour.
      expect(await scalar(people.admin, "SELECT has_org_capability($1::uuid,'manage_members') AS value", [org])).toBe(true);

      // ---------------------------------------------------------- money writes, role by role
      const managers = ["owner", "adminGranted", "scoutGranted"] as const;
      const others = ["admin", "scout", "viewer"] as const;

      const moneyInserts: Array<[string, (id: string) => [string, unknown[]]]> = [
        [
          "season_costs",
          (id) => [
            `INSERT INTO season_costs(org_id,season_year,label,category,amount_usd,incurred_on,status,created_by)
             VALUES($1,2026,'Registration','registration',5000,'2026-01-10','paid',$2)`,
            [org, id],
          ],
        ],
        [
          "finance_categories",
          (id) => [`INSERT INTO finance_categories(org_id,season_year,name) VALUES($1,2026,$2)`, [org, `Parts ${id}`]],
        ],
        [
          "season_budgets",
          (id) => [
            `INSERT INTO season_budgets(org_id,season_year,total_budget_usd,created_by) VALUES($1,2026,9000,$2)
             ON CONFLICT (org_id,season_year) DO UPDATE SET total_budget_usd = EXCLUDED.total_budget_usd`,
            [org, id],
          ],
        ],
        [
          "finance_transactions (manual)",
          (id) => [
            `INSERT INTO finance_transactions(org_id,season_year,type,source,amount_usd,created_by,source_kind)
             VALUES($1,2026,'income','manual',100,$2,'manual')`,
            [org, id],
          ],
        ],
        [
          "finance_season_settings",
          (id) => [
            `INSERT INTO finance_season_settings(org_id,season_year,operating_budget_usd,fundraising_goal_usd,updated_by)
             VALUES($1,2026,1,1,$2)
             ON CONFLICT (org_id,season_year) DO UPDATE SET updated_by = EXCLUDED.updated_by`,
            [org, id],
          ],
        ],
      ];
      for (const [table, build] of moneyInserts) {
        for (const who of managers) {
          const [sql, params] = build(people[who]);
          expect((await attempt(people[who], sql, params)).ok, `${who} writes ${table}`).toBe(true);
        }
        for (const who of others) {
          const [sql, params] = build(people[who]);
          expect((await attempt(people[who], sql, params)).ok, `${who} cannot write ${table}`).toBe(false);
        }
      }

      // A member cannot forge income through the BOM mirror, but BOM estimates
      // (never cash) stay member-writable.
      const forged = await attempt(
        people.scout,
        `INSERT INTO finance_transactions(org_id,season_year,type,source,amount_usd,created_by,source_kind,source_id,counts_in_balance)
         VALUES($1,2026,'income','other',100000,$2,'bom',gen_random_uuid(),true)`,
        [org, people.scout],
      );
      expect(forged.ok).toBe(false);
      const estimate = await attempt(
        people.scout,
        `INSERT INTO finance_transactions(org_id,season_year,type,source,amount_usd,created_by,source_kind,source_id,counts_in_balance)
         VALUES($1,2026,'expense','other',40,$2,'bom',gen_random_uuid(),false)`,
        [org, people.scout],
      );
      expect(estimate.ok).toBe(true);

      // ---------------------------------------------------------- asking stays open to members
      const ask = (id: string, title: string) =>
        attempt(
          id,
          `INSERT INTO purchase_requests(org_id,season_year,requested_by,title,unit_cost_usd,total_cost_usd)
           VALUES($1,2026,$2,$3,20,40) RETURNING id`,
          [org, id, title],
        );
      expect((await ask(people.scout, "NEO 550")).ok, "a team member can ask").toBe(true);
      expect((await ask(people.viewer, "Snacks")).ok, "a viewer cannot ask").toBe(false);
      const requestId = (
        await client.query(`SELECT id FROM purchase_requests WHERE org_id=$1 AND title='NEO 550'`, [org])
      ).rows[0]!.id as string;

      const decide = (id: string) =>
        attempt(id, `UPDATE purchase_requests SET status='approved', reviewed_by=$2, reviewed_at=now() WHERE id=$1`, [
          requestId,
          id,
        ]);
      const selfApprove = await decide(people.scout);
      expect(selfApprove.ok, "the requester cannot approve their own ask").toBe(false);
      expect((await decide(people.admin)).ok, "an admin the owner did not choose cannot decide").toBe(false);
      expect((await decide(people.scoutGranted)).ok, "a chosen team member can decide").toBe(true);
      // Once decided, the approved dollars are locked to finance managers.
      const reprice = await attempt(people.scout, `UPDATE purchase_requests SET total_cost_usd=4000 WHERE id=$1`, [requestId]);
      expect(reprice.ok).toBe(false);

      // Reimbursements: file your own; only a finance manager sees and decides others'.
      const claim = await attempt(
        people.scout,
        `INSERT INTO reimbursement_requests(org_id,season_year,member_user_id,amount_usd,description,status,submitted_at)
         VALUES($1,2026,$2,18.5,'Hardware store','submitted',now())`,
        [org, people.scout],
      );
      expect(claim.ok, claim.message).toBe(true);
      expect(
        (
          await attempt(
            people.viewer,
            `INSERT INTO reimbursement_requests(org_id,season_year,member_user_id,amount_usd,description,status)
             VALUES($1,2026,$2,5,'Pizza','draft')`,
            [org, people.viewer],
          )
        ).ok,
      ).toBe(false);
      const claimsVisibleTo = async (id: string) =>
        Number(await scalar(id, `SELECT count(*)::int AS value FROM reimbursement_requests WHERE org_id=$1`, [org]));
      expect(await claimsVisibleTo(people.admin)).toBe(0);
      expect(await claimsVisibleTo(people.adminGranted)).toBe(1);
      const approveClaim = (id: string) =>
        attempt(
          id,
          `UPDATE reimbursement_requests SET status='approved', approver_user_id=$2, decided_at=now()
           WHERE org_id=$1 AND member_user_id=$3`,
          [org, id, people.scout],
        );
      expect((await approveClaim(people.admin)).ok).toBe(false);
      expect((await approveClaim(people.scout)).ok, "no approving your own claim").toBe(false);
      expect((await approveClaim(people.adminGranted)).ok).toBe(true);

      // Fundraisers: members run events; proceeds are money.
      const event = await attempt(
        people.scout,
        `INSERT INTO fundraiser_events(org_id,season_year,name,event_date,created_by) VALUES($1,2026,'Car wash','2026-03-01',$2)`,
        [org, people.scout],
      );
      expect(event.ok).toBe(true);
      expect(
        (
          await attempt(
            people.viewer,
            `INSERT INTO fundraiser_events(org_id,season_year,name,event_date,created_by) VALUES($1,2026,'Bake sale','2026-03-02',$2)`,
            [org, people.viewer],
          )
        ).ok,
      ).toBe(false);
      const proceeds = (id: string) =>
        attempt(id, `UPDATE fundraiser_events SET proceeds_usd = proceeds_usd + 250 WHERE org_id=$1 AND name='Car wash'`, [org]);
      const scoutProceeds = await proceeds(people.scout);
      expect(scoutProceeds.ok).toBe(false);
      expect(scoutProceeds.message).toMatch(/owner chose can change money/);
      expect((await proceeds(people.admin)).ok).toBe(false);
      expect((await proceeds(people.scoutGranted)).ok).toBe(true);
      const deleteWithProceeds = await attempt(people.scout, `DELETE FROM fundraiser_events WHERE org_id=$1 AND name='Car wash'`, [org]);
      expect(deleteWithProceeds.ok, "deleting raised money is a money write").toBe(false);

      // Sponsor money: recording it is finance; a sponsor lead may still thank them.
      const sponsor = (
        await client.query(`INSERT INTO sponsors(org_id,name,created_by) VALUES($1,'Acme',$2) RETURNING id`, [org, people.owner])
      ).rows[0]!.id as string;
      const contribute = (id: string) =>
        attempt(
          id,
          `INSERT INTO sponsor_contributions(sponsor_id,org_id,season_year,type,amount_usd,created_by)
           VALUES($1,$2,2026,'cash',1000,$3)`,
          [sponsor, org, id],
        );
      expect((await contribute(people.admin)).ok).toBe(false);
      expect((await contribute(people.owner)).ok).toBe(true);
      expect(
        (await attempt(people.admin, `UPDATE sponsor_contributions SET thank_you_sent_at=now() WHERE org_id=$1`, [org])).ok,
        "a sponsor lead still records the thank-you",
      ).toBe(true);
      const bump = await attempt(people.admin, `UPDATE sponsor_contributions SET amount_usd=5000 WHERE org_id=$1`, [org]);
      expect(bump.ok).toBe(false);
      expect(bump.message).toMatch(/owner chose can change money/);

      // Grant awards and allocations.
      const opportunity = (
        await client.query(`INSERT INTO grant_opportunities(org_id,name,created_by) VALUES($1,'STEM fund',$2) RETURNING id`, [
          org,
          people.owner,
        ])
      ).rows[0]!.id as string;
      const application = (
        await client.query(
          `INSERT INTO grant_applications(org_id,grant_opportunity_id,season_year,status) VALUES($1,$2,2026,'submitted') RETURNING id`,
          [org, opportunity],
        )
      ).rows[0]!.id as string;
      const award = (id: string) =>
        attempt(id, `UPDATE grant_applications SET status='awarded', amount_awarded_usd=2500 WHERE id=$1`, [application]);
      const adminAward = await award(people.admin);
      expect(adminAward.ok).toBe(false);
      expect(adminAward.message).toMatch(/owner chose can change money/);
      expect((await award(people.scoutGranted)).ok, "a chosen team member can record the award").toBe(true);

      const expense = (
        await client.query(
          `INSERT INTO finance_transactions(org_id,season_year,type,source,amount_usd,created_by,source_kind)
           VALUES($1,2026,'expense','manual',300,$2,'manual') RETURNING id`,
          [org, people.owner],
        )
      ).rows[0]!.id as string;
      const allocate = (id: string) =>
        attempt(
          id,
          `INSERT INTO grant_finance_allocations(org_id,grant_application_id,finance_transaction_id,amount_usd,created_by)
           VALUES($1,$2,$3,50,$4)
           ON CONFLICT (org_id,grant_application_id,finance_transaction_id) DO UPDATE SET amount_usd=EXCLUDED.amount_usd`,
          [org, application, expense, id],
        );
      expect((await allocate(people.scout)).ok).toBe(false);
      expect((await allocate(people.adminGranted)).ok).toBe(true);

      // ---------------------------------------------------------- reading stays open
      for (const who of others) {
        expect(
          Number(await scalar(people[who], `SELECT count(*)::int AS value FROM season_costs WHERE org_id=$1`, [org])),
          `${who} still reads season costs`,
        ).toBeGreaterThan(0);
      }

      // ---------------------------------------------------------- losing access
      // Becoming view-only ends money access, even though an admin made the change.
      await client.query("UPDATE memberships SET role='viewer' WHERE org_id=$1 AND user_id=$2", [org, people.scoutGranted]);
      expect(await scalar(people.scoutGranted, "SELECT can_manage_finances($1::uuid) AS value", [org])).toBe(false);
      expect(
        (
          await client.query(
            `SELECT 1 FROM membership_capabilities WHERE org_id=$1 AND user_id=$2 AND capability='manage_budget'`,
            [org, people.scoutGranted],
          )
        ).rowCount,
      ).toBe(0);
      // Leaving the team removes the grant, so it cannot come back on re-join.
      await client.query("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", [org, people.adminGranted]);
      expect(
        (
          await client.query(
            `SELECT 1 FROM membership_capabilities WHERE org_id=$1 AND user_id=$2 AND capability='manage_budget'`,
            [org, people.adminGranted],
          )
        ).rowCount,
      ).toBe(0);

      // The owner can always take it back.
      await client.query(
        `INSERT INTO membership_capabilities(org_id,user_id,capability,granted_by) VALUES($1,$2,'manage_budget',$3)`,
        [org, people.admin, people.owner],
      );
      expect(await scalar(people.admin, "SELECT can_manage_finances($1::uuid) AS value", [org])).toBe(true);
      expect(
        (
          await attempt(
            people.owner,
            `DELETE FROM membership_capabilities WHERE org_id=$1 AND user_id=$2 AND capability='manage_budget'`,
            [org, people.admin],
          )
        ).ok,
      ).toBe(true);
      expect(await scalar(people.admin, "SELECT can_manage_finances($1::uuid) AS value", [org])).toBe(false);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });
});
