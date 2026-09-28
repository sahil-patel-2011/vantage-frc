import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("collection-time training consent in PostgreSQL", () => {
  it("excludes opted-out activity permanently and applies withdrawal before dataset reads", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const org = randomUUID(), user = randomUUID();
    const before = randomUUID(), during = randomUUID(), after = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Training fixture')", [user, `${user}@example.test`]);
      await client.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [user]);
      await client.query("INSERT INTO organizations(id,slug,name) VALUES($1::uuid,$1::text,'Training fixture')", [org]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [org, user]);
      const insert = (id: string, forgedConsent = false) => client.query(`INSERT INTO ai_runs(id,org_id,user_id,capability,status,privacy_scope,request_id,input,training_eligible_at_collection)
        VALUES($1::uuid,$2,$3,'chat','completed','private',$1::text,'{"message":"synthetic"}',$4)`, [id, org, user, forgedConsent]);
      await insert(before);
      await client.query("INSERT INTO org_ai_training_choice(org_id,training_allowed,updated_by) VALUES($1,false,$2)", [org, user]);
      await insert(during, true);
      expect((await client.query("SELECT id FROM ai_runs_training_eligible WHERE org_id=$1", [org])).rows).toEqual([]);
      await client.query("UPDATE org_ai_training_choice SET training_allowed=true WHERE org_id=$1", [org]);
      await insert(after);
      await client.query("UPDATE ai_runs SET training_eligible_at_collection=true WHERE id=$1", [during]);
      expect((await client.query("SELECT id FROM ai_runs_training_eligible WHERE org_id=$1 ORDER BY created_at,id", [org])).rows.map((row: { id: string }) => row.id).sort()).toEqual([before, after].sort());
      expect((await client.query("SELECT training_eligible_at_collection FROM ai_runs WHERE id=$1", [during])).rows[0].training_eligible_at_collection).toBe(false);
      await client.query("SET LOCAL ROLE vantage_training");
      expect((await client.query("SELECT id FROM ai_runs_training_eligible WHERE org_id=$1", [org])).rowCount).toBe(2);
      await client.query("SAVEPOINT forbidden_raw");
      await expect(client.query("SELECT input FROM ai_runs LIMIT 1")).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK TO SAVEPOINT forbidden_raw");
      await client.query("RESET ROLE");
      await client.query("UPDATE org_ai_training_choice SET training_allowed=false WHERE org_id=$1", [org]);
      await client.query("SET LOCAL ROLE vantage_training");
      expect((await client.query("SELECT id FROM ai_runs_training_eligible WHERE org_id=$1", [org])).rowCount).toBe(0);
    } finally { await client.query("ROLLBACK"); await client.end(); }
  });
});
