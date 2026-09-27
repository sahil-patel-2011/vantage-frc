import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { queueReadableHubSync } from "./hub-jobs";
const fake = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("workflow/api", () => ({ start: fake.start }));
vi.mock("./hub-workflow", () => ({ readableHubWorkflow: () => undefined }));
vi.mock("../provisioning/pool", () => ({ provisioningPool: () => workerPool! }));
const url = process.env.TEST_DATABASE_ADMIN_URL;
const pool = url ? new pg.Pool({ connectionString: url, max: 4 }) : null;
const workerPool = url ? new pg.Pool({ connectionString: url, max: 4, options: "-c role=vantage_worker" }) : null;
const suite = url ? describe.sequential : describe.skip;
suite("durable hub coordination against PostgreSQL", () => {
  const owner = randomUUID(), outsider = randomUUID(), orgId = randomUUID(), otherOrg = randomUUID();
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    for (const id of [owner, outsider]) {
      await pool!.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Synthetic sync actor')", [id, `${id}@example.test`]);
      await pool!.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [id]);
    }
    for (const [id, userId] of [[orgId, owner], [otherOrg, outsider]]) {
      await pool!.query("INSERT INTO organizations(id,name,slug) VALUES($1::uuid,'Synthetic sync team',$1::text)", [id]);
      await pool!.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [id, userId]);
      await pool!.query("INSERT INTO team_provisioning_jobs(org_id,requested_by) VALUES($1,$2)", [id, userId]);
    }
    fake.start.mockResolvedValue({ runId: "controlled-workflow" });
  });
  afterAll(async () => {
    await pool?.query("DELETE FROM organizations WHERE id=ANY($1::uuid[])", [[orgId, otherOrg]]);
    await pool?.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[owner, outsider]]);
    await pool?.end();
    await workerPool?.end();
  });
  it("blocks unready teams, coalesces concurrent triggers and retains previous successful freshness after dispatch failure", async () => {
    expect(await queueReadableHubSync(orgId)).toBe(false);
    expect(fake.start).not.toHaveBeenCalled();
    await pool!.query("UPDATE team_provisioning_jobs SET state='ready',verified_at=now() WHERE org_id=$1", [orgId]);
    const concurrent = await Promise.all([queueReadableHubSync(orgId), queueReadableHubSync(orgId), queueReadableHubSync(orgId)]);
    expect(concurrent.filter(Boolean)).toHaveLength(1);
    expect(fake.start).toHaveBeenCalledOnce();
    const previous = (await pool!.query("SELECT generation FROM team_readable_sync_jobs WHERE org_id=$1", [orgId])).rows[0].generation;
    await pool!.query("UPDATE team_readable_sync_jobs SET state='ready',requested_at=now()-interval '3 minutes',last_verified_at='2026-09-26T12:00:00Z' WHERE org_id=$1", [orgId]);
    fake.start.mockRejectedValueOnce(new Error("Provider unavailable"));
    await expect(queueReadableHubSync(orgId)).rejects.toThrow(/could not start/);
    const row = (await pool!.query("SELECT state,generation,last_verified_at,error FROM team_readable_sync_jobs WHERE org_id=$1", [orgId])).rows[0];
    expect(row.state).toBe("failed"); expect(row.generation).not.toBe(previous);
    expect(row.last_verified_at.toISOString()).toBe("2026-09-26T12:00:00.000Z");
    expect(row.error).toMatch(/will retry/);
  });
  it("provides member-only status, rejects client mutations, and covers the new table in recovery", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN"); await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [outsider]);
      expect((await client.query("SELECT org_id FROM team_readable_sync_jobs WHERE org_id=$1", [orgId])).rowCount).toBe(0);
      await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
      expect((await client.query("SELECT org_id FROM team_readable_sync_jobs WHERE org_id=$1", [orgId])).rowCount).toBe(1);
      await client.query("SAVEPOINT denied_write");
      await expect(client.query("UPDATE team_readable_sync_jobs SET state='ready' WHERE org_id=$1", [orgId])).rejects.toThrow(/permission denied/);
      await client.query("ROLLBACK TO SAVEPOINT denied_write");
      await client.query("SET LOCAL ROLE vantage_worker");
      const coverage = (await client.query("SELECT rows_covered,truncation_covered FROM recovery_coverage WHERE table_name='team_readable_sync_jobs'")).rows[0];
      expect(coverage).toEqual({ rows_covered: true, truncation_covered: true });
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
