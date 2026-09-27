import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
const migration = readFileSync(new URL("../migrations/0705_onboarding_check_compatibility.sql", import.meta.url), "utf8");

suite("onboarding schema compatibility against PostgreSQL", () => {
  for (const shape of ["legacy", "fresh"] as const) {
    it(`${shape}: preserves historical checks, both release interfaces, exact times and role isolation`, async () => {
      const target = new URL(url!);
      if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
      const client = new pg.Client({ connectionString: url });
      const schema = `onboarding_test_${randomUUID().replaceAll("-", "")}`;
      const org = randomUUID(), owner = randomUUID(), other = randomUUID();
      const historicTime = "2026-09-01T12:00:00.123456Z";
      await client.connect();
      try {
        await client.query("BEGIN");
        await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public`);
        await client.query(`CREATE TABLE member_onboarding_checks(
          ${shape === "fresh" ? "id uuid PRIMARY KEY DEFAULT gen_random_uuid()," : ""}
          org_id uuid NOT NULL,user_id uuid NOT NULL,track_key text NOT NULL,
          ${shape === "fresh" ? "check_key text NOT NULL,completed_at timestamptz NOT NULL DEFAULT now(),UNIQUE(org_id,user_id,track_key,check_key)" : "item_key text NOT NULL,checked_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(org_id,user_id,track_key,item_key)"})`);
        await client.query(`INSERT INTO member_onboarding_checks(org_id,user_id,track_key,${shape === "fresh" ? "check_key,completed_at" : "item_key,checked_at"}) VALUES($1,$2,'welcome','historic',$3)`, [org, owner, historicTime]);
        await client.query(migration);
        await client.query(migration); // Reapplication must preserve keys/time.
        expect((await client.query("SELECT count(*)::int AS count FROM pg_index WHERE indrelid='member_onboarding_checks'::regclass AND indisunique")).rows[0].count).toBe(3);
        const original = (await client.query("SELECT id,check_key,item_key,to_char(completed_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS stamp,completed_at=checked_at AS equal FROM member_onboarding_checks")).rows[0];
        expect(original).toMatchObject({ check_key: "historic", item_key: "historic", stamp: historicTime, equal: true });
        expect(original.id).toMatch(/^[a-f0-9-]{36}$/);
        await client.query("INSERT INTO member_onboarding_checks(org_id,user_id,track_key,check_key) VALUES($1,$2,'welcome','canonical') ON CONFLICT(org_id,user_id,track_key,check_key) DO NOTHING", [org, owner]);
        await client.query("INSERT INTO member_onboarding_checks(org_id,user_id,track_key,item_key) VALUES($1,$2,'welcome','canonical') ON CONFLICT(org_id,user_id,track_key,item_key) DO NOTHING", [org, owner]);
        expect((await client.query("SELECT count(*)::int AS count FROM member_onboarding_checks")).rows[0].count).toBe(2);
        await client.query("UPDATE member_onboarding_checks SET completed_at=$1 WHERE check_key='canonical'", [historicTime]);
        expect((await client.query("SELECT bool_and(completed_at=checked_at) AS equal FROM member_onboarding_checks")).rows[0].equal).toBe(true);
        await client.query("UPDATE member_onboarding_checks SET item_key='renamed' WHERE check_key='canonical'");
        expect((await client.query("SELECT check_key FROM member_onboarding_checks WHERE item_key='renamed'")).rows[0].check_key).toBe("renamed");
        await client.query("SAVEPOINT conflicting");
        await expect(client.query("UPDATE member_onboarding_checks SET check_key='a',item_key='b' WHERE check_key='renamed'")).rejects.toThrow(/aliases disagree/);
        await client.query("ROLLBACK TO SAVEPOINT conflicting");
        await client.query(`ALTER TABLE member_onboarding_checks ENABLE ROW LEVEL SECURITY;
          GRANT USAGE ON SCHEMA ${schema} TO vantage_app;
          GRANT SELECT,INSERT,DELETE ON member_onboarding_checks TO vantage_app;
          CREATE POLICY own_checks ON member_onboarding_checks TO vantage_app USING(user_id=current_app_user_id()) WITH CHECK(user_id=current_app_user_id())`);
        await client.query("SET LOCAL ROLE vantage_app");
        await client.query("SELECT set_config('app.user_id',$1,true)", [other]);
        expect((await client.query("SELECT * FROM member_onboarding_checks")).rowCount).toBe(0);
        await client.query("SAVEPOINT unauthorized");
        await expect(client.query("INSERT INTO member_onboarding_checks(org_id,user_id,track_key,check_key) VALUES($1,$2,'welcome','forged')", [org, owner])).rejects.toThrow(/row-level security/);
        await client.query("ROLLBACK TO SAVEPOINT unauthorized");
        await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
        expect((await client.query("SELECT * FROM member_onboarding_checks")).rowCount).toBe(2);
      } finally { await client.query("ROLLBACK"); await client.end(); }
    });
  }
});
