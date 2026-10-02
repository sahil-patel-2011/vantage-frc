import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { initializeTeamDefaults } from "./defaults";
import { loadWorkbookSource } from "../microsoft/workbook-sync";
import { readRegisteredHubUrl } from "../google-sheets/sheets-hub";
import { ensureRecoveryBoundary } from "./recovery-boundary";
import { recordProviderWait } from "./provider-wait";
import { GoogleSheetsError } from "../google-sheets/google-api";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;
suite("team defaults against PostgreSQL", () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 1 }) : null;
  const userId = randomUUID();
  const orgId = randomUUID();
  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    await pool!.query("INSERT INTO users(id,email,name) VALUES($1,$2,'Defaults owner')", [userId, `${userId}@example.test`]);
    await pool!.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [userId]);
    await pool!.query("INSERT INTO organizations(id,name,slug) VALUES($1::uuid,'Defaults proof',$1::text)", [orgId]);
    await pool!.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [orgId, userId]);
  });
  afterAll(async () => {
    await pool?.query("DELETE FROM organizations WHERE id=$1", [orgId]);
    await pool?.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool?.end();
  });
  it("rejects incomplete registration and preserves existing choices across retries", async () => {
    const client = await pool!.connect();
    try {
      const defaultsClient = client as unknown as PoolClient;
      await expect(initializeTeamDefaults(defaultsClient, orgId)).rejects.toThrow(/settings/);
      expect((await client.query("SELECT id FROM scout_schemas WHERE org_id=$1", [orgId])).rows).toEqual([]);
      await client.query("INSERT INTO org_billing(org_id,period_start,period_end) VALUES($1,now(),now()+interval '1 month')", [orgId]);
      await initializeTeamDefaults(defaultsClient, orgId);
      expect((await client.query("SELECT type FROM scout_schemas WHERE org_id=$1 ORDER BY type", [orgId])).rows.map((row) => row.type).sort()).toEqual(["match", "pit"]);
      expect((await client.query("SELECT count(*)::int AS count FROM finance_categories WHERE org_id=$1", [orgId])).rows[0].count).toBe(6);
      await client.query("UPDATE dashboards SET name='My custom board' WHERE org_id=$1", [orgId]);
      await client.query("UPDATE scout_schemas SET schema=jsonb_set(schema,'{title}','\"Custom scouting\"') WHERE org_id=$1", [orgId]);
      await initializeTeamDefaults(defaultsClient, orgId);
      expect((await client.query("SELECT name FROM dashboards WHERE org_id=$1", [orgId])).rows).toEqual([{ name: "My custom board" }]);
      expect((await client.query("SELECT schema->>'title' AS title FROM scout_schemas WHERE org_id=$1", [orgId])).rows.every((row) => row.title === "Custom scouting")).toBe(true);
      expect((await client.query("SELECT count(*)::int AS count FROM finance_categories WHERE org_id=$1", [orgId])).rows[0].count).toBe(6);
    } finally { client.release(); }
  });
  it("loads the registered team through the production worker role", async () => {
    const client = await pool!.connect();
    try {
      await client.query("SET ROLE vantage_worker");
      const source = await loadWorkbookSource(client as unknown as PoolClient, orgId, { strict: true });
      expect(source.orgName).toBe("Defaults proof");
      expect(source.ops?.Members).toHaveLength(1);
      expect(source.ops?.Members?.[0]?.id).toBe(userId);
    } finally { await client.query("RESET ROLE"); client.release(); }
  });
  it("keeps initialization inside the claim transaction with owner row security", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true)", [userId, orgId]);
      await client.query("UPDATE dashboards SET name='Uncommitted fixture' WHERE org_id=$1", [orgId]);
      await initializeTeamDefaults(client as unknown as PoolClient, orgId, { inTransaction: true });
      await client.query("ROLLBACK");
      expect((await client.query("SELECT name FROM dashboards WHERE org_id=$1", [orgId])).rows).toEqual([{ name: "My custom board" }]);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("reads the registered operator bridge through the worker without owner access", async () => {
    const client = await pool!.connect();
    const bridgeUrl = "https://script.google.com/macros/s/AKfycbx1234567890abcdefghijkLMNOP/exec";
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO platform_sheets_hub(id,url) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET url=EXCLUDED.url", [bridgeUrl]);
      await client.query("SET LOCAL ROLE vantage_worker");
      expect(await readRegisteredHubUrl(client as unknown as PoolClient)).toBe(bridgeUrl);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("retains the original recovery boundary across retries and later status changes", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO team_provisioning_jobs(org_id,requested_by) VALUES($1,$2)", [orgId, userId]);
      await client.query("SET LOCAL ROLE vantage_worker");
      const boundary = await ensureRecoveryBoundary(client as unknown as PoolClient, orgId);
      await client.query("UPDATE team_provisioning_jobs SET state='running',updated_at=clock_timestamp()+interval '1 minute' WHERE org_id=$1", [orgId]);
      expect((await ensureRecoveryBoundary(client as unknown as PoolClient, orgId)).toISOString()).toBe(boundary.toISOString());
      const row = (await client.query("SELECT updated_at,recovery_boundary_at FROM team_provisioning_jobs WHERE org_id=$1", [orgId])).rows[0];
      expect(row.updated_at.getTime()).toBeGreaterThan(row.recovery_boundary_at.getTime());
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
  it("persists quota waits through the restricted worker without losing completed resources", async () => {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      const resources = { workbooks: { Competition: { id: "existing-book", schemaVersion: 2 } } };
      await client.query("INSERT INTO team_provisioning_jobs(org_id,requested_by,phase,completed_phases,resources) VALUES($1,$2,'sheets',ARRAY['team','workspace','tools'],$3::jsonb)", [orgId, userId, JSON.stringify(resources)]);
      await client.query("SET LOCAL ROLE vantage_worker");
      const now = Date.parse("2026-09-26T20:00:00Z");
      const error = new GoogleSheetsError("throttled", "Quota used", null, "daily_quota", 7_200_000);
      expect(await recordProviderWait(client as unknown as PoolClient, orgId, error, now)).toBe(7_200_000);
      const row = (await client.query("SELECT state,phase,resources,completed_phases,retry_after_at,error FROM team_provisioning_jobs WHERE org_id=$1", [orgId])).rows[0];
      expect(row.state).toBe("waiting");
      expect(row.phase).toBe("sheets");
      expect(row.resources).toEqual(resources);
      expect(row.completed_phases).toEqual(["team", "workspace", "tools"]);
      expect(row.retry_after_at.toISOString()).toBe("2026-09-26T22:00:00.000Z");
      expect(row.error).toMatch(/retry automatically/);
      expect(await recordProviderWait(client as unknown as PoolClient, orgId, new Error("Other failure"), now)).toBeNull();
      expect((await client.query("SELECT state FROM team_provisioning_jobs WHERE org_id=$1", [orgId])).rows[0].state).toBe("waiting");
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
