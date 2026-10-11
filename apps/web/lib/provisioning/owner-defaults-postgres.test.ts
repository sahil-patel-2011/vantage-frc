import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import type { PoolClient } from "@neondatabase/serverless";
import { expect, it, vi } from "vitest";
import { acceptOrganizationInvite } from "@vantage/core";
import { ensureFirstOwnerTeamDefaults } from "./owner-defaults";

/**
 * An /admin team in invited mode: organization + billing + an owner invite, no member yet.
 * The owner accepting under row security (vantage_app, app.user_id = owner) must be enough for
 * the starter forms, finance categories, Home and a join code; a scout accepting adds nothing.
 */
it.skipIf(!process.env.TEST_DATABASE_ADMIN_URL)(
  "an admin-provisioned team gets its defaults when the invited owner accepts, under owner row security",
  async () => {
    const url = new URL(process.env.TEST_DATABASE_ADMIN_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    expect(url.pathname).toMatch(/(?:^|[_/])(?:test|ci)(?:[_/]|$)/);
    const pool = new Pool({ connectionString: url.href, ssl: false, max: 1 });
    const client = await pool.connect();
    const admin = randomUUID(), owner = randomUUID(), scout = randomUUID(), org = randomUUID();
    vi.stubEnv("BETTER_AUTH_SECRET", "owner-defaults-postgres-fixture");
    const token = (role: string) => {
      const raw = randomBytes(32).toString("base64url");
      return { raw, hash: createHash("sha256").update(raw).digest("hex"), role };
    };
    try {
      await client.query("BEGIN");
      for (const [id, role] of [[admin, "mentor"], [owner, "mentor"], [scout, "student"]] as const) {
        await client.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,'Defaults fixture',true)", [id, `${id}@example.test`]);
        await client.query(
          "INSERT INTO profiles(user_id,first_name,last_name,date_of_birth,gender,team_role,onboarding_completed_at) VALUES($1,'Defaults','Fixture','2000-01-01','prefer_not_to_say',$2,now())",
          [id, role],
        );
      }
      await client.query("INSERT INTO organizations(id,name,slug) VALUES($1::uuid,'Admin fixture',$1::text)", [org]);
      await client.query(
        "INSERT INTO org_billing(org_id,tier,credit_cap_usd,period_start,period_end) VALUES($1,'free',0,date_trunc('month',now()),date_trunc('month',now())+interval '1 month')",
        [org],
      );
      const ownerInvite = token("owner"), scoutInvite = token("scout");
      for (const [invite, email] of [[ownerInvite, `${owner}@example.test`], [scoutInvite, `${scout}@example.test`]] as const) {
        await client.query(
          "INSERT INTO invites(org_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,$3::org_role,$4,$5,now()+interval '1 day')",
          [org, email, invite.role, invite.hash, admin],
        );
      }

      await client.query("SET LOCAL ROLE vantage_app");
      const asUser = async (userId: string) => client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id','',true)", [userId]);
      const service = client as unknown as PoolClient;
      const count = async (table: string) => {
        await client.query("RESET ROLE");
        const value = (await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE org_id=$1`, [org])).rows[0].n as number;
        await client.query("SET LOCAL ROLE vantage_app");
        return value;
      };

      await asUser(owner);
      expect(await acceptOrganizationInvite(service, owner, ownerInvite.raw)).toBe(org);
      expect(await ensureFirstOwnerTeamDefaults(service, org, owner)).toEqual({ defaults: true, joinCode: true });
      expect(await count("scout_schemas")).toBe(2);
      expect(await count("finance_categories")).toBe(6);
      expect(await count("dashboards")).toBe(1);
      expect(await count("team_join_codes")).toBe(1);
      const code = (await client.query("SELECT pin_hash FROM team_join_codes WHERE org_id=$1", [org])).rows[0].pin_hash as string;

      // Retried (a second accept path, onboarding completion): nothing duplicated, the code is kept.
      expect(await ensureFirstOwnerTeamDefaults(service, org, owner)).toEqual({ defaults: true, joinCode: false });
      expect(await count("scout_schemas")).toBe(2);
      expect((await client.query("SELECT pin_hash FROM team_join_codes WHERE org_id=$1", [org])).rows[0].pin_hash).toBe(code);

      await asUser(scout);
      expect(await acceptOrganizationInvite(service, scout, scoutInvite.raw)).toBe(org);
      expect(await ensureFirstOwnerTeamDefaults(service, org, scout)).toEqual({ defaults: false, joinCode: false });
      expect(await count("dashboards")).toBe(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
      vi.unstubAllEnvs();
    }
  },
);
