import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { completeOnboarding, getOnboardingState } from "./onboarding";

const url = process.env.TEST_DATABASE_ADMIN_URL;
const suite = url ? describe : describe.skip;

suite("actual PostgreSQL onboarding team evidence", () => {
  it("distinguishes a preference, pending request, and explicitly missing workspace without granting membership", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(decodeURIComponent(target.pathname.slice(1)))) {
      throw new Error("Dedicated loopback test/CI database required");
    }
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const user = randomUUID(), missingUser = randomUUID(), org = randomUUID();
    try {
      await client.query("BEGIN");
      const numbers = await client.query<{ number: number }>(
        "SELECT number FROM generate_series(90000,99999) number WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE team_number=number) ORDER BY number LIMIT 2",
      );
      const existingNumber = numbers.rows[0]?.number;
      const missingNumber = numbers.rows[1]?.number;
      if (existingNumber == null || missingNumber == null) throw new Error("Two unused fixture team numbers are required");
      // Both adapters expose the same query/release contract used by these
      // services. Real SQL executes through pg against the scratch database.
      const serviceClient = client as unknown as PoolClient;
      for (const id of [user, missingUser]) {
        await client.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,'Onboarding fixture',true)", [id, `${id}@example.test`]);
        await client.query("INSERT INTO profiles(user_id,first_name,last_name,date_of_birth,gender,preferred_team_number,onboarding_completed_at) VALUES($1,'Onboarding','Fixture','2000-01-01','prefer_not_to_say',$2,now())", [id, existingNumber]);
      }
      await client.query("INSERT INTO organizations(id,slug,name,team_number) VALUES($1,$2,'Onboarding fixture',$3)", [org, org, existingNumber]);
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.org_id','',true)", [user]);
      const preferred = await getOnboardingState(serviceClient, user);
      expect(preferred.preferredTeamNumber).toBe(existingNumber);
      expect(preferred.accessStatus).toBe("none");
      expect(preferred.workspaceMissing).toBeUndefined();
      const payload = {
        firstName: "Onboarding", lastName: "Fixture", dateOfBirth: "2000-01-01",
        gender: "prefer_not_to_say" as const, preferredTeamNumber: existingNumber,
        teamRole: "student" as const, primaryFocus: "competition" as const,
        termsAccepted: true, privacyAccepted: true,
      };
      const requested = await completeOnboarding(serviceClient, user, payload);
      expect(requested.accessStatus).toBe("pending");
      expect(requested.workspaceOrgId).toBe(org);
      expect(requested.workspaceMissing).toBeUndefined();
      expect((await client.query("SELECT count(*)::int count FROM memberships WHERE user_id=$1", [user])).rows[0].count).toBe(0);

      await client.query("SELECT set_config('app.user_id',$1,true)", [missingUser]);
      const missing = await completeOnboarding(serviceClient, missingUser, { ...payload, preferredTeamNumber: missingNumber });
      expect(missing.accessStatus).toBe("none");
      expect(missing.workspaceMissing).toBe(true);
      expect(missing.complete).toBe(true);
      expect((await client.query("SELECT count(*)::int count FROM memberships WHERE user_id=$1", [missingUser])).rows[0].count).toBe(0);
      // A later read makes no directory claim from a preference alone. The
      // exact request result is evidence, not a promise about future setup.
      expect((await getOnboardingState(serviceClient, missingUser)).workspaceMissing).toBeUndefined();
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  });
});
