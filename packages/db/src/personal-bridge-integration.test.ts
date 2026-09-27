import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("personal bridge permissions against PostgreSQL", () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 1 }) : null;
  beforeAll(() => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
  });
  afterAll(async () => { await pool?.end(); });
  it("isolates claims and results even between people on the same team", async () => {
    const client = await pool!.connect();
    const [alice, bob, org, deviceA, deviceB, jobA, jobB] = Array.from({ length: 7 }, () => randomUUID());
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Alice'),($3,$4,'Bob')", [alice, `${alice}@example.test`, bob, `${bob}@example.test`]);
      await client.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01'),($2,'2000-01-01')", [alice, bob]);
      await client.query("INSERT INTO organizations(id,name,slug) VALUES($1::uuid,'Bridge proof',$1::text)", [org]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'scout')", [org, alice, bob]);
      await client.query(`INSERT INTO ai_bridge_devices(id,org_id,paired_by,name,token_hash,engines)
        VALUES($1::uuid,$2,$3,'Alice',$1::text,'{"codex":{"available":true}}'),($4::uuid,$2,$5,'Bob',$4::text,'{"codex":{"available":true}}')`, [deviceA, org, alice, deviceB, bob]);
      await client.query(`INSERT INTO ai_bridge_jobs(id,org_id,requested_by,feature,messages,requested_engine)
        VALUES($1,$2,$3,'chat','{"prompt":"Alice private question"}','codex'),($4,$2,$5,'chat','{"prompt":"Bob private question"}','codex')`, [jobA, org, alice, jobB, bob]);
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [bob]);
      expect((await client.query("SELECT id::text FROM ai_bridge_devices WHERE org_id=$1", [org])).rows).toEqual([{ id: deviceB }]);
      expect((await client.query("SELECT id::text FROM ai_bridge_jobs WHERE org_id=$1", [org])).rows).toEqual([{ id: jobB }]);
      expect((await client.query("UPDATE ai_bridge_devices SET revoked_at=now() WHERE id=$1", [deviceA])).rowCount).toBe(0);
      await client.query("RESET ROLE");
      const bobClaim = (await client.query("SELECT * FROM claim_ai_bridge_job($1,'lease-b')", [deviceB])).rows[0];
      expect(bobClaim.job_id).toBe(jobB);
      expect(bobClaim.messages.prompt).toBe("Bob private question");
      await client.query("SAVEPOINT rejected_result");
      await expect(client.query("SELECT complete_ai_bridge_job($1,'lease-b',$2,'done','{}',NULL,NULL)", [deviceA, jobB])).rejects.toThrow(/lease/);
      await client.query("ROLLBACK TO SAVEPOINT rejected_result");
      expect((await client.query("SELECT complete_ai_bridge_job($1,'lease-b',$2,'done','{\"text\":\"Bob answer\"}',NULL,NULL) AS ok", [deviceB, jobB])).rows[0].ok).toBe(true);
      const aliceClaim = (await client.query("SELECT * FROM claim_ai_bridge_job($1,'lease-a')", [deviceA])).rows[0];
      expect(aliceClaim.job_id).toBe(jobA);
      // Membership revocation invalidates an outstanding lease, including result writes.
      await client.query("DELETE FROM memberships WHERE org_id=$1 AND user_id=$2", [org, alice]);
      await client.query("SAVEPOINT revoked_result");
      await expect(client.query("SELECT complete_ai_bridge_job($1,'lease-a',$2,'done','{}',NULL,NULL)", [deviceA, jobA])).rejects.toThrow(/lease/);
      await client.query("ROLLBACK TO SAVEPOINT revoked_result");
      await client.query("SAVEPOINT revoked_claim");
      await expect(client.query("SELECT * FROM claim_ai_bridge_job($1,'new-lease')", [deviceA])).rejects.toThrow(/member/);
      await client.query("ROLLBACK TO SAVEPOINT revoked_claim");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
