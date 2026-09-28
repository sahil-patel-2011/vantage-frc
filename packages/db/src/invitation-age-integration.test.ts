import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("invitation membership age boundary in PostgreSQL", () => {
  it("rejects missing, null and underage birthdays, admits the thirteenth birthday, and preserves denied profiles", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(decodeURIComponent(target.pathname.slice(1)))) throw new Error("Dedicated local test/CI database required.");
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    const org = randomUUID(), user = randomUUID();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Age boundary fixture')", [user, `${user}@example.test`]);
      await client.query("INSERT INTO organizations(id,slug,name) VALUES($1::uuid,$1::text,'Age boundary fixture')", [org]);
      const rejectedJoin = async () => {
        await client.query("SAVEPOINT reject_join");
        await expect(client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'scout')", [org, user])).rejects.toThrow(/Finish your profile first/);
        await client.query("ROLLBACK TO SAVEPOINT reject_join");
        expect((await client.query("SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2", [org, user])).rowCount).toBe(0);
      };
      await rejectedJoin();
      await client.query("INSERT INTO profiles(user_id) VALUES($1)", [user]);
      await rejectedJoin();
      await client.query("UPDATE profiles SET date_of_birth=(CURRENT_DATE-interval '13 years'+interval '1 day')::date WHERE user_id=$1", [user]);
      await rejectedJoin();
      expect((await client.query("SELECT 1 FROM profiles WHERE user_id=$1", [user])).rowCount).toBe(1);
      await client.query("UPDATE profiles SET date_of_birth=(CURRENT_DATE-interval '13 years')::date WHERE user_id=$1", [user]);
      await client.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'scout')", [org, user]);
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [user]);
      expect((await client.query("SELECT is_org_member($1) AS allowed", [org])).rows[0].allowed).toBe(true);
      await client.query("RESET ROLE");
      await client.query("UPDATE profiles SET date_of_birth=CURRENT_DATE-interval '12 years' WHERE user_id=$1", [user]);
      await client.query("SET LOCAL ROLE vantage_app");
      expect((await client.query("SELECT is_org_member($1) AS allowed", [org])).rows[0].allowed).toBe(false);
      await client.query("RESET ROLE");
      expect((await client.query("SELECT 1 FROM memberships WHERE user_id=$1", [user])).rowCount).toBe(1);
    } finally { await client.query("ROLLBACK"); await client.end(); }
  });
});
