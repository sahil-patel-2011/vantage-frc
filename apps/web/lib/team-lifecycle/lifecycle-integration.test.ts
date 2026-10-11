import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { initializeTeamDefaults } from "../provisioning/defaults";
import { teamSetupDone } from "../role-onboarding/compute";
import { lifecycleRefusal } from "./model";
import { deleteMyAccount, deleteTeam, leaveTeam, listTeamLifecycle, renameTeam } from "./store";

// Migration 0720 against a real database, as the request role (vantage_app) through RLS, the way
// withRls() runs it. TEST_DATABASE_ADMIN_URL must point at a dedicated local test database.
const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe.sequential : describe.skip;

suite("team lifecycle against PostgreSQL", () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 1 }) : null;
  const owner = randomUUID();
  const scout = randomUUID();
  const viewer = randomUUID();
  const orgId = randomUUID();
  const teamNumber = 90000 + Math.floor(Math.random() * 9000);

  async function as<T>(userId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool!.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id',$2,true)", [userId, orgId]);
      const result = await work(client as unknown as PoolClient);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    const target = new URL(url!);
    if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.includes("test")) throw new Error("Dedicated local test database required.");
    for (const [id, name] of [[owner, "Lifecycle owner"], [scout, "Riley Scout"], [viewer, "Pat Parent"]] as const) {
      await pool!.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,$3,true)", [id, `${id}@example.test`, name]);
      await pool!.query("INSERT INTO profiles(user_id,date_of_birth) VALUES($1,'2000-01-01')", [id]);
    }
    await pool!.query("INSERT INTO organizations(id,name,slug,team_number) VALUES($1::uuid,'Lifecycle proof',$1::text,$2)", [orgId, teamNumber]);
    await pool!.query("INSERT INTO org_billing(org_id,period_start,period_end) VALUES($1,now(),now()+interval '1 month')", [orgId]);
    await pool!.query("INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'scout'),($1,$4,'viewer')", [orgId, owner, scout, viewer]);
  });

  afterAll(async () => {
    await pool?.query("DELETE FROM organizations WHERE id=$1", [orgId]);
    await pool?.query("DELETE FROM notifications WHERE user_id = ANY($1::uuid[])", [[owner, scout, viewer]]);
    await pool?.end();
  });

  it("does not tick the scouting step for the starter forms every team gets (A2-06)", async () => {
    const client = await pool!.connect();
    try {
      await initializeTeamDefaults(client as unknown as PoolClient, orgId);
    } finally {
      client.release();
    }
    const done = await as(owner, (client) => teamSetupDone(client, orgId));
    expect(done.has("team_setup::scouting")).toBe(false);
    await pool!.query(
      `INSERT INTO scout_schemas(org_id,year,type,version,schema,created_by)
       SELECT org_id,year,type,2,schema,$2 FROM scout_schemas WHERE org_id=$1 AND type='match' AND version=1`,
      [orgId, owner],
    );
    expect((await as(owner, (client) => teamSetupDone(client, orgId))).has("team_setup::scouting")).toBe(true);
  });

  it("lets an owner rename the team and refuses a team member", async () => {
    expect(await as(owner, (client) => renameTeam(client, owner, orgId, "  Lifecycle   proof 2 "))).toBe("Lifecycle proof 2");
    await expect(as(scout, (client) => renameTeam(client, scout, orgId, "Hijacked"))).rejects.toMatchObject({ reason: "not_allowed" });
  });

  it("refuses the last owner's leave, and lets a view-only member leave", async () => {
    const refusal = await as(owner, (client) => leaveTeam(client, orgId)).catch((error: unknown) => error);
    expect(lifecycleRefusal(refusal)).toBe("last_owner");
    await as(viewer, (client) => leaveTeam(client, orgId));
    const teams = await as(viewer, (client) => listTeamLifecycle(client, viewer));
    expect(teams).toEqual([]);
    const notes = await as(owner, async (client) =>
      (await client.query<{ title: string }>(`SELECT payload->>'title' AS title FROM notifications WHERE type='member_left' AND org_id=$1`, [orgId])).rows,
    );
    expect(notes).toEqual([{ title: "Pat Parent left the team" }]);
  });

  it("deletes an account down to a nameless row that can't sign in", async () => {
    const session = randomUUID();
    await pool!.query("INSERT INTO sessions(id,expires_at,token,user_id) VALUES($1::uuid,now()+interval '1 day',$2,$3)", [session, session, scout]);
    const refusal = await as(scout, (client) => deleteMyAccount(client, "someone@else.test")).catch((error: unknown) => error);
    expect(lifecycleRefusal(refusal)).toBe("confirm_mismatch");
    await as(scout, (client) => deleteMyAccount(client, `${scout.toUpperCase()}@EXAMPLE.TEST`));
    const row = (await pool!.query("SELECT name,email,email_verified FROM users WHERE id=$1", [scout])).rows[0];
    expect(row).toEqual({ name: "Former member", email: `deleted-${scout}@deleted.invalid`, email_verified: false });
    for (const table of ["memberships", "sessions", "profiles"]) {
      expect((await pool!.query(`SELECT count(*)::int AS n FROM ${table} WHERE user_id=$1`, [scout])).rows[0].n).toBe(0);
    }
  });

  it("lets only the owner delete the team, with its number typed", async () => {
    expect(lifecycleRefusal(await as(owner, (client) => deleteTeam(client, orgId, "1")).catch((error: unknown) => error))).toBe("confirm_mismatch");
    await as(owner, (client) => deleteTeam(client, orgId, String(teamNumber)));
    expect((await pool!.query("SELECT count(*)::int AS n FROM organizations WHERE id=$1", [orgId])).rows[0].n).toBe(0);
    expect((await pool!.query("SELECT count(*)::int AS n FROM scout_schemas WHERE org_id=$1", [orgId])).rows[0].n).toBe(0);
    expect((await pool!.query("SELECT payload->>'by' AS by FROM admin_actions WHERE action='organization.deleted' AND payload->>'orgId'=$1", [orgId])).rows).toEqual([{ by: "owner" }]);
  });
});
