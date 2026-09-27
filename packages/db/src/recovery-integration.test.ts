import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("transactional recovery against PostgreSQL", () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 3 }) : null;
  const table = `recovery_test_${randomUUID().replaceAll("-", "")}`;
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error("Dedicated local test database required.");
    await pool!.query(`CREATE TABLE ${table}(amount numeric, note text)`);
  });
  afterAll(async () => {
    await pool?.query(`DROP TABLE IF EXISTS ${table}`);
    await pool?.query("DELETE FROM recovery_events WHERE table_name=$1", [table]);
    await pool?.end();
  });
  it("detects a new table before capture is installed, then covers rows and truncation", async () => {
    expect((await pool!.query("SELECT rows_covered,truncation_covered FROM recovery_coverage WHERE table_name=$1", [table])).rows[0]).toEqual({ rows_covered: false, truncation_covered: false });
    await pool!.query("SELECT install_recovery_capture()");
    expect((await pool!.query("SELECT rows_covered,truncation_covered FROM recovery_coverage WHERE table_name=$1", [table])).rows[0]).toEqual({ rows_covered: true, truncation_covered: true });
  });
  it("rolls the journal back with the write and retains exact values on commit", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO ${table} VALUES(123456789012345678901234567890.123456789,'=SUM(A:A)🤖')`);
      await client.query("ROLLBACK");
      expect((await client.query("SELECT id FROM recovery_events WHERE table_name=$1", [table])).rows).toEqual([]);
      await client.query(`INSERT INTO ${table} VALUES(123456789012345678901234567890.123456789,'=SUM(A:A)🤖')`);
      const row = (await client.query("SELECT after_record FROM recovery_events WHERE table_name=$1", [table])).rows[0];
      expect(row.after_record).toContain("123456789012345678901234567890.123456789");
      expect(row.after_record).toContain("=SUM(A:A)🤖");
      await client.query(`UPDATE ${table} SET note='changed'`);
      await client.query(`DELETE FROM ${table}`);
      await client.query(`TRUNCATE ${table}`);
      const events = (await client.query("SELECT operation,before_record,after_record FROM recovery_events WHERE table_name=$1 ORDER BY id", [table])).rows;
      expect(events.map((event) => event.operation)).toEqual(["INSERT", "UPDATE", "DELETE", "TRUNCATE"]);
      expect(events[1].before_record).toContain("🤖");
      expect(events[2].after_record).toBeNull();
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("keeps an earlier allocated event pending when its transaction commits late", async () => {
    const first = await pool!.connect();
    const later = await pool!.connect();
    try {
      await first.query("BEGIN");
      await first.query(`INSERT INTO ${table} VALUES(1,'late commit')`);
      const earlyId = (await first.query("SELECT id::text FROM recovery_events WHERE table_name=$1 AND after_record LIKE '%late commit%'", [table])).rows[0].id;
      await later.query(`INSERT INTO ${table} VALUES(2,'first commit')`);
      const laterId = (await later.query("SELECT id::text FROM recovery_events WHERE table_name=$1 AND after_record LIKE '%first commit%'", [table])).rows[0].id;
      expect(BigInt(earlyId)).toBeLessThan(BigInt(laterId));
      await later.query("UPDATE recovery_events SET exported_at=now() WHERE id=$1", [laterId]);
      await first.query("COMMIT");
      const pending = (await later.query("SELECT id::text FROM recovery_events WHERE id=ANY($1::bigint[]) AND exported_at IS NULL", [[earlyId, laterId]])).rows;
      expect(pending).toEqual([{ id: earlyId }]);
    } finally { await first.query("ROLLBACK"); first.release(); later.release(); }
  });
});
