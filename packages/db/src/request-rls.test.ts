import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe : describe.skip;
suite("request role under an administrator connection", () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 1 }) : null;
  afterAll(async () => { await pool?.end(); });
  it("enforces policies and resets the role and identity after rollback", async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    const client = await pool!.connect();
    try {
      const before = (await client.query("SELECT current_user AS role")).rows[0].role;
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", ["00000000-0000-4000-8000-000000000999"]);
      expect((await client.query("SELECT current_user AS role")).rows[0].role).toBe("vantage_app");
      expect((await client.query("SELECT id FROM organizations")).rows).toEqual([]);
      await client.query("ROLLBACK");
      expect((await client.query("SELECT current_user AS role")).rows[0].role).toBe(before);
      expect((await client.query("SELECT nullif(current_setting('app.user_id',true),'') AS actor")).rows[0].actor).toBeNull();
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
