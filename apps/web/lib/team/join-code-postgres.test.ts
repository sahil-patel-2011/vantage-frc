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
      org = randomUUID();
    vi.stubEnv("BETTER_AUTH_SECRET", "join-code-postgres-fixture");
    try {
      await client.query("BEGIN");
      for (const id of [owner, member]) {
        await client.query(
          "INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,'Code fixture',true)",
          [id, `${id}@example.test`],
        );
        await client.query(
          "INSERT INTO profiles(user_id,first_name,last_name,date_of_birth,gender,team_role,onboarding_completed_at) VALUES($1,'Code','Fixture','2000-01-01','prefer_not_to_say','student',now())",
          [id],
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
      expect(await setTeamJoinCode(service, org, "001234")).toBe("001234");
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
      await client.query("SELECT set_config('app.user_id','',true)");
      expect(await request(null)).toBeNull();
      expect(await request("wrong!")).toBeNull();
      expect(await request("001234")).toBeTruthy();
      await client.query("SELECT set_config('app.user_id',$1,true)", [owner]);
      expect(
        (
          await client.query(
            "SELECT expires_at > now()+interval '29 minutes' AND expires_at <= now()+interval '30 minutes' AS short_lived FROM invites WHERE token_hash=encode(digest($1,'sha256'),'hex')",
            [token],
          )
        ).rows[0].short_lived,
      ).toBe(true);
      await client.query("SELECT set_config('app.user_id',$1,true)", [member]);
      expect(
        (
          await client.query("SELECT * FROM team_join_codes WHERE org_id=$1", [
            org,
          ])
        ).rowCount,
      ).toBe(0);
      await expect(assertJoinCodeManager(service, org)).rejects.toThrow(
        /Administrator/,
      );
      await acceptOrganizationInvite(service, member, token);
      expect(
        (
          await client.query(
            "SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
            [org, member],
          )
        ).rows[0].role,
      ).toBe("scout");
      // Even after joining, a code holder cannot retrieve or change the team secret.
      expect(
        (
          await client.query("SELECT * FROM team_join_codes WHERE org_id=$1", [
            org,
          ])
        ).rowCount,
      ).toBe(0);
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
      for (let i = 0; i < 5; i++)
        expect(
          await request("000000", "d".repeat(20), `guess-${i}@example.test`),
        ).toBeNull();
      expect(
        await request("654321", "d".repeat(20), "locked@example.test"),
      ).toBeNull();
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
