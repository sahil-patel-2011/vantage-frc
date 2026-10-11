import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { PoolClient } from "@neondatabase/serverless";
import { expect, it, vi } from "vitest";
import { acceptOrganizationInvite } from "@vantage/core";
import { assertJoinCodeManager, setTeamJoinCode } from "./join-code";

it.skipIf(!process.env.TEST_DATABASE_ADMIN_URL)(
  "join codes enforce tenant roles, verified invitations, rotation and persistent attempt limits",
  async () => {
    const url = new URL(process.env.TEST_DATABASE_ADMIN_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    expect(url.pathname).toMatch(/(?:^|[_/])(?:test|ci)(?:[_/]|$)/);
    const pool = new Pool({ connectionString: url.href, ssl: false, max: 1 }),
      client = await pool.connect();
    const owner = randomUUID(),
      member = randomUUID(),
      parent = randomUUID(),
      org = randomUUID();
    vi.stubEnv("BETTER_AUTH_SECRET", "join-code-postgres-fixture");
    try {
      await client.query("BEGIN");
      for (const [id, teamRole] of [[owner, "mentor"], [member, "student"], [parent, "parent"]]) {
        await client.query(
          "INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,'Code fixture',true)",
          [id, `${id}@example.test`],
        );
        await client.query(
          "INSERT INTO profiles(user_id,first_name,last_name,date_of_birth,gender,team_role,onboarding_completed_at) VALUES($1,'Code','Fixture','2000-01-01','prefer_not_to_say',$2,now())",
          [id, teamRole],
        );
      }
      const team = (
        await client.query(
          "SELECT team_number FROM teams_ref t WHERE NOT EXISTS(SELECT 1 FROM organizations o WHERE o.team_number=t.team_number) LIMIT 1",
        )
      ).rows[0].team_number;
      await client.query(
        "INSERT INTO organizations(id,name,slug,team_number) VALUES($1,'Code fixture',$2,$3)",
        [org, `code-${org}`, team],
      );
      await client.query(
        "INSERT INTO memberships(org_id,user_id,role) VALUES($1,$2,'owner')",
        [org, owner],
      );
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
      const service = client as unknown as PoolClient;
      const codeState = async () =>
        (await client.query("SELECT enabled, join_role::text AS role FROM team_join_codes WHERE org_id=$1", [org])).rows[0];

      // A team's first code, made at setup, is off until someone turns it on (QA A3-01).
      expect(await setTeamJoinCode(service, org, "009999", { enable: false })).toBe("009999");
      expect(await codeState()).toEqual({ enabled: false, role: "viewer" });
      // An explicit new code turns it on; joiners still get Parent or guest unless chosen.
      expect(await setTeamJoinCode(service, org, "001234")).toBe("001234");
      expect(await codeState()).toEqual({ enabled: true, role: "viewer" });
      await expect(setTeamJoinCode(service, org, "001234")).rejects.toThrow(
        /different code/,
      );
      const token = randomBytes(32).toString("base64url");
      const request = async (
        pin: string | null,
        ip = "a".repeat(20),
        email = `${member}@example.test`,
        raw = token,
      ) =>
        (
          await client.query(
            "SELECT request_team_code_invite($1,$2,$3,$4,$5) AS id",
            [team, pin, email, ip, raw],
          )
        ).rows[0].id;
      const retryAt = async (email: string, ip: string) =>
        (await client.query("SELECT team_code_join_retry_at($1,$2,$3) AS at", [team, email, ip])).rows[0].at;
      await client.query("SELECT set_config('app.user_id','',true)");
      expect(await request(null)).toBeNull();
      expect(await request("wrong!")).toBeNull();
      expect(await request("001234")).toBeTruthy();
      await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
      expect(
        (
          await client.query(
            "SELECT expires_at > now()+interval '29 minutes' AND expires_at <= now()+interval '30 minutes' AS short_lived, role::text AS role FROM invites WHERE token_hash=encode(digest($1,'sha256'),'hex')",
            [token],
          )
        ).rows[0],
      ).toEqual({ short_lived: true, role: "viewer" });
      await client.query("SELECT set_config('app.user_id',$1,true)", [member]);
      expect(
        (
          await client.query("SELECT * FROM team_join_codes WHERE org_id=$1", [
            org,
          ])
        ).rowCount,
      ).toBe(0);
      await expect(assertJoinCodeManager(service, org)).rejects.toThrow(
        /Only the team owner/,
      );
      await acceptOrganizationInvite(service, member, token);
      // Nobody chose this person's access: a code joiner starts as Parent or guest.
      expect(
        (
          await client.query(
            "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
            [org, member],
          )
        ).rows[0].role,
      ).toBe("viewer");
      // A code joiner (now a member) cannot read the team's invites or anyone's email (QA A3-03).
      expect((await client.query("SELECT email FROM invites WHERE org_id=$1", [org])).rowCount).toBe(0);
      // Even after joining, a code holder cannot retrieve or change the team secret.
      expect(
        (
          await client.query("SELECT * FROM team_join_codes WHERE org_id=$1", [
            org,
          ])
        ).rowCount,
      ).toBe(0);

      // The owner lets code joiners in as Students; someone who says they are a parent still only looks.
      await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
      await client.query("UPDATE team_join_codes SET join_role='scout' WHERE org_id=$1", [org]);
      const parentToken = randomBytes(32).toString("base64url");
      expect(await request("001234", "p".repeat(20), `${parent}@example.test`, parentToken)).toBeTruthy();
      await client.query("SELECT set_config('app.user_id',$1,true)", [parent]);
      await acceptOrganizationInvite(service, parent, parentToken);
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [org, parent])).rows[0].role).toBe("viewer");

      await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
      const stale = randomBytes(32).toString("base64url");
      expect(
        await request("001234", "b".repeat(20), "stale@example.test", stale),
      ).toBeTruthy();
      await setTeamJoinCode(service, org, "654321");
      expect(
        (
          await client.query(
            "SELECT status FROM invites WHERE token_hash=encode(digest($1,'sha256'),'hex')",
            [stale],
          )
        ).rows[0].status,
      ).toBe("revoked");
      expect(await request("001234", "c".repeat(20))).toBeNull();
      // Five wrong tries lock that person (network + team + address), the right code included,
      // and the app can say when to come back; nobody else on that network is locked (QA A3-14).
      for (let i = 0; i < 5; i++)
        expect(await request("000000", "d".repeat(20), "typo@example.test", randomBytes(32).toString("base64url"))).toBeNull();
      expect(await request("654321", "d".repeat(20), "typo@example.test", randomBytes(32).toString("base64url"))).toBeNull();
      expect(await retryAt("typo@example.test", "d".repeat(20))).toBeInstanceOf(Date);
      expect(await retryAt("classmate@example.test", "d".repeat(20))).toBeNull();
      expect(
        await request("654321", "d".repeat(20), "classmate@example.test", randomBytes(32).toString("base64url")),
      ).toBeTruthy();
      // Guessing across many addresses from one network still locks that network for the team.
      for (let i = 0; i < 20; i++)
        expect(await request("000000", "g".repeat(20), `guess-${i}@example.test`, randomBytes(32).toString("base64url"))).toBeNull();
      expect(await request("654321", "g".repeat(20), "fresh@example.test", randomBytes(32).toString("base64url"))).toBeNull();
      expect(await retryAt("fresh@example.test", "g".repeat(20))).toBeInstanceOf(Date);
      expect(
        await request(
          "654321",
          "e".repeat(20),
          "valid@example.test",
          randomBytes(32).toString("base64url"),
        ),
      ).toBeTruthy();
      for (let i = 0; i < 8; i++) {
        expect(
          await request(
            "654321",
            `email-limit-${i}`,
            "email-limit@example.test",
            randomBytes(32).toString("base64url"),
          ),
        ).toBeTruthy();
      }
      expect(
        await request(
          "654321",
          "email-limit-9",
          "email-limit@example.test",
          randomBytes(32).toString("base64url"),
        ),
      ).toBeNull();
      await client.query(
        "UPDATE team_join_codes SET enabled=false WHERE org_id=$1",
        [org],
      );
      expect(
        await request("654321", "f".repeat(20), "disabled@example.test"),
      ).toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
      vi.unstubAllEnvs();
    }
  },
  30_000,
);
