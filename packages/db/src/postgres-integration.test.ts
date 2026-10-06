import type { PoolClient as DomainClient } from "@neondatabase/serverless";
import { setMemberCapabilities } from "../../core/src/capabilities";
import { listMemberHubAccess, setMemberHubAccess } from "../../core/src/hub-access";
import { saveRoleProfile, applyRoleProfile } from "../../core/src/role-profiles";
import { claimFirstTour } from "../../core/src/first-run-tour";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const describeWithDatabase = TEST_DATABASE_ADMIN_URL ? describe.sequential : describe.skip;

if (!TEST_DATABASE_ADMIN_URL) {
  console.info("Skipping real Postgres integration: TEST_DATABASE_ADMIN_URL is not set.");
}

function assertSafeTestDatabase(connectionString: string): void {
  const url = new URL(connectionString);
  const database = decodeURIComponent(url.pathname.slice(1));
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);

  if (process.env.NODE_ENV === "production" || !localHost || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(database)) {
    throw new Error(
      "TEST_DATABASE_ADMIN_URL must target a local dedicated database whose name contains a test/ci segment",
    );
  }
}

function runMigrations(connectionString: string): string {
  return execFileSync(process.execPath, ["scripts/run-migrations.mjs"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_ADMIN_URL: connectionString,
      DATABASE_URL_UNPOOLED: "",
      POSTGRES_URL_NON_POOLING: "",
      DATABASE_URL: "",
      POSTGRES_URL: "",
    },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function visibleOrganizations(client: PoolClient, role: "vantage_app" | "vantage_worker", userId?: string) {
  await client.query("BEGIN");
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    if (userId) {
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    }
    const result = await client.query<{ id: string }>("SELECT id::text FROM organizations ORDER BY id");
    return result.rows.map((row) => row.id);
  } finally {
    await client.query("ROLLBACK");
  }
}

describeWithDatabase(
  "real Postgres migrations and RLS (isolated authorized test runner)",
  () => {
    let pool: Pool;
    let migrationCount = 0;

    beforeAll(async () => {
      assertSafeTestDatabase(TEST_DATABASE_ADMIN_URL!);
      pool = new Pool({ connectionString: TEST_DATABASE_ADMIN_URL, max: 1, ssl: false });
      await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
      await pool.query("CREATE SCHEMA public");
      await pool.query("GRANT ALL ON SCHEMA public TO public");
    }, 300_000);

    afterAll(async () => {
      await pool?.end();
    });

    it(
      "applies every migration to a fresh schema and cleanly reapplies",
      async () => {
        const firstRun = runMigrations(TEST_DATABASE_ADMIN_URL!);
        expect(firstRun).toContain("APPLY 0000_foundation.sql");
        expect(firstRun).toContain("OK 0496_org_llm_byok_endpoint.sql");

        const countResult = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM schema_migrations",
        );
        migrationCount = Number(countResult.rows[0]?.count);
        expect(migrationCount).toBeGreaterThan(300);

        const secondRun = runMigrations(TEST_DATABASE_ADMIN_URL!);
        expect(secondRun).not.toContain("APPLY ");
        expect((secondRun.match(/^SKIP /gm) ?? []).length).toBe(migrationCount);

        const reappliedCount = await pool.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM schema_migrations",
        );
        expect(Number(reappliedCount.rows[0]?.count)).toBe(migrationCount);
      },
      300_000,
    );

    it("isolates two organizations for vantage_app while vantage_worker sees both", async () => {
      const userOne = "00000000-0000-4000-8000-000000000001";
      const userTwo = "00000000-0000-4000-8000-000000000002";
      const orgOne = "10000000-0000-4000-8000-000000000001";
      const orgTwo = "10000000-0000-4000-8000-000000000002";

      await pool.query(
        `INSERT INTO users (id, email, name)
         VALUES ($1::uuid, 'rls-one@example.test', 'RLS One'),
                ($2::uuid, 'rls-two@example.test', 'RLS Two')`,
        [userOne, userTwo],
      );
      await pool.query(
        `INSERT INTO organizations (id, name, slug, team_number)
         VALUES ($1::uuid, 'RLS Org One', 'rls-org-one', 9001),
                ($2::uuid, 'RLS Org Two', 'rls-org-two', 9002)`,
        [orgOne, orgTwo],
      );
      await pool.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01'),($2,'2000-01-01')", [userOne, userTwo]);
      await pool.query(
        `INSERT INTO memberships (org_id, user_id, role)
         VALUES ($1::uuid, $2::uuid, 'owner'),
                ($3::uuid, $4::uuid, 'owner')`,
        [orgOne, userOne, orgTwo, userTwo],
      );

      const client = await pool.connect();
      try {
        expect(await visibleOrganizations(client, "vantage_app", userOne)).toEqual([orgOne]);
        expect(await visibleOrganizations(client, "vantage_app", userTwo)).toEqual([orgTwo]);
        expect(await visibleOrganizations(client, "vantage_worker")).toEqual([orgOne, orgTwo]);
      } finally {
        client.release();
      }
    });

    it("delegates scouting without global admin and revokes it immediately at RLS", async () => {
      const lead="00000000-0000-4000-8000-000000000003", member="00000000-0000-4000-8000-000000000004";
      const owner="00000000-0000-4000-8000-000000000001", org="10000000-0000-4000-8000-000000000001", foreign="10000000-0000-4000-8000-000000000002";
      const client=await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`INSERT INTO users(id,email,name) VALUES($1,'lead@example.test','Lead'),($2,'scout@example.test','Scout')`,[lead,member]);
        await client.query(`INSERT INTO profiles(user_id,date_of_birth,onboarding_completed_at) VALUES($1,'2000-01-01',now()),($2,'2000-01-01',now())`,[lead,member]);
        await client.query(`INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'scout'),($1,$3,'scout')`,[org,lead,member]);
        await client.query("SET LOCAL ROLE vantage_app");
        await client.query("SELECT set_config('app.user_id',$1,true)",[owner]);
        await setMemberHubAccess(client as unknown as DomainClient,owner,{orgId:org,userId:lead,access:[{hubId:"competition",allowedTabIds:["scouting"]},{hubId:"team",allowedTabIds:["people"]}]});
        await setMemberCapabilities(client as unknown as DomainClient,owner,{orgId:org,userId:lead,capabilities:["manage_scouting"]});
        expect(await listMemberHubAccess(client as unknown as DomainClient,org,lead)).toEqual([{hubId:"competition",allowedTabIds:[]},{hubId:"team",allowedTabIds:["people"]}]);
        const profile=await saveRoleProfile(client as unknown as DomainClient,owner,org,{key:"test-lead",name:"Test lead",baseRole:"scout",capabilities:["manage_scouting"],hubAccess:{competition:["scouting"],team:["people"]}});
        expect(profile.hubAccess).toEqual({competition:[],team:["people"]});
        await applyRoleProfile(client as unknown as DomainClient,owner,{orgId:org,userId:lead,key:profile.key});
        await client.query("SELECT set_config('app.user_id',$1,true)",[lead]);
        expect((await client.query(`SELECT has_org_capability($1,'manage_scouting') AS scout,has_org_capability($1,'manage_members') AS members,can_manage_scouting($2) AS foreign`,[org,foreign])).rows[0]).toEqual({scout:true,members:false,foreign:false});
        const schema=await client.query(`INSERT INTO scout_schemas(org_id,year,type,version,schema,created_by) VALUES($1,2026,'match',987,'{"title":"Lead form","fields":[]}',$2) RETURNING id`,[org,lead]);
        expect(schema.rowCount).toBe(1);
        const event=await client.query(`INSERT INTO events_ref(event_key,year,name,org_id,created_by) VALUES('2026custom-12345678-lead',2026,'Lead offseason',$1,$2) RETURNING event_key`,[org,lead]);
        expect(event.rowCount).toBe(1);
        await client.query(`INSERT INTO org_active_context(org_id,active_event_key) VALUES($1,'2026custom-12345678-lead') ON CONFLICT(org_id) DO UPDATE SET active_event_key=EXCLUDED.active_event_key`,[org]);
        await client.query("SAVEPOINT foreign_write");
        await expect(client.query(`INSERT INTO scout_schemas(org_id,year,type,version,schema,created_by) VALUES($1,2026,'match',987,'{"fields":[]}',$2)`,[foreign,lead])).rejects.toThrow(/row-level security/);
        await client.query("ROLLBACK TO SAVEPOINT foreign_write");
        await client.query("SELECT set_config('app.user_id',$1,true)",[member]);
        expect((await client.query("SELECT id FROM scout_schemas WHERE id=$1",[schema.rows[0].id])).rowCount).toBe(1);
        expect((await client.query("DELETE FROM scout_schemas WHERE id=$1 RETURNING id",[schema.rows[0].id])).rowCount).toBe(0);
        await client.query("RESET ROLE");
        await client.query("DELETE FROM membership_capabilities WHERE org_id=$1 AND user_id=$2",[org,lead]);
        await client.query("SET LOCAL ROLE vantage_app");
        await client.query("SELECT set_config('app.user_id',$1,true)",[lead]);
        expect((await client.query("SELECT can_manage_scouting($1) AS allowed",[org])).rows[0].allowed).toBe(false);
        expect((await client.query("DELETE FROM scout_schemas WHERE id=$1 RETURNING id",[schema.rows[0].id])).rowCount).toBe(0);
      } finally { await client.query("ROLLBACK");client.release(); }
    });

    it("stores the first-run tour once per account and denies another user's claim", async () => {
      const client=await pool.connect(), user="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002";
      try {
        await client.query("BEGIN");
        await client.query("UPDATE profiles SET onboarding_completed_at=now(),app_tour_seen_at=NULL WHERE user_id=$1",[user]);
        await client.query("SET LOCAL ROLE vantage_app");
        await client.query("SELECT set_config('app.user_id',$1,true)",[user]);
        expect(await claimFirstTour(client as unknown as DomainClient,user)).toBe(true);
        expect(await claimFirstTour(client as unknown as DomainClient,user)).toBe(false);
        await client.query("SELECT set_config('app.user_id',$1,true)",[other]);
        expect(await claimFirstTour(client as unknown as DomainClient,user)).toBe(false);
      } finally {await client.query("ROLLBACK");client.release();}
    });

    it("keeps event-free observations team-scoped and binds the author at the database", async () => {
      const client = await pool.connect();
      const org = "10000000-0000-4000-8000-000000000001";
      const author = "00000000-0000-4000-8000-000000000001";
      const other = "00000000-0000-4000-8000-000000000002";
      const report = "20000000-0000-4000-8000-000000000099";
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE vantage_app");
        await client.query("SELECT set_config('app.user_id', $1, true)", [author]);
        await client.query(`INSERT INTO free_scout_reports
          (id,org_id,scout_user_id,year,type,team_number,label,definition,payload,observed_at)
          VALUES ($1,$2,$3,2026,'match',6925,'Practice 1','{}','{"auto_fuel":0}',now())`, [report, org, author]);
        expect((await client.query("SELECT payload FROM free_scout_reports WHERE id=$1", [report])).rows[0].payload.auto_fuel).toBe(0);
        await client.query("SELECT set_config('app.user_id', $1, true)", [other]);
        expect((await client.query("SELECT id FROM free_scout_reports WHERE id=$1", [report])).rows).toHaveLength(0);
        expect((await client.query("DELETE FROM free_scout_reports WHERE id=$1 RETURNING id", [report])).rowCount).toBe(0);
        await client.query("SAVEPOINT reject_spoof");
        await expect(client.query(`INSERT INTO free_scout_reports
          (id,org_id,scout_user_id,year,type,team_number,label,definition,payload,observed_at)
          VALUES (gen_random_uuid(),$1,$2,2026,'pit',6925,'Spoof','{}','{}',now())`, [org, author])).rejects.toThrow(/row-level security/);
        await client.query("ROLLBACK TO SAVEPOINT reject_spoof");
        await client.query("SELECT set_config('app.user_id', $1, true)", [author]);
        expect((await client.query("DELETE FROM free_scout_reports WHERE id=$1 RETURNING id", [report])).rowCount).toBe(1);
      } finally { await client.query("ROLLBACK"); client.release(); }
    });
  },
);
