import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { removeMember } from "./capabilities";
import { acceptOrganizationInvite, createOrganizationInvite, suggestTeamInvite } from "./membership";
import { latestTeamRemoval } from "./membership-notices";

const url = process.env.TEST_DATABASE_ADMIN_URL;
(url ? describe : describe.skip)("real PostgreSQL membership notices (0721)", () => {
  it("tells a removed member, lets a student ask for a mentor, and only raises access on accept", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) {
      throw new Error("Dedicated local test database required");
    }
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const service = client as unknown as PoolClient;
    const owner = randomUUID(), student = randomUUID(), parent = randomUUID(), org = randomUUID();
    const as = (user: string) => client.query("SELECT set_config('app.user_id',$1,true)", [user]);
    try {
      await client.query("BEGIN");
      for (const [user, role] of [[owner, "mentor"], [student, "student"], [parent, "parent"]] as const) {
        await client.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,$3,true)", [user, `${user}@example.test`, `Fixture ${role}`]);
        await client.query(
          "INSERT INTO profiles(user_id,first_name,last_name,date_of_birth,gender,team_role,onboarding_completed_at) VALUES($1,'Fixture',$2,'2000-01-01','prefer_not_to_say',$2,now())",
          [user, role],
        );
      }
      const team = (await client.query("SELECT team_number FROM teams_ref t WHERE NOT EXISTS(SELECT 1 FROM organizations o WHERE o.team_number=t.team_number) LIMIT 1")).rows[0].team_number;
      await client.query("INSERT INTO organizations(id,name,slug,team_number) VALUES($1,'Notice fixture',$2,$3)", [org, `notice-${org}`, team]);
      // Joined yesterday, as members are in real life (the fixture is all one transaction, whose
      // now() is what "joined in this request" is measured against).
      await client.query(
        "INSERT INTO memberships(org_id,user_id,role,created_at) VALUES($1,$2,'owner',now()-interval '1 day'),($1,$3,'scout',now()-interval '1 day'),($1,$4,'viewer',now()-interval '1 day')",
        [org, owner, student, parent],
      );
      await client.query("SET LOCAL ROLE vantage_app");

      // A student asks the owner to invite a mentor: one notice to the owner, nothing else.
      await as(student);
      await expect(suggestTeamInvite(service, { orgId: org, email: "Coach@School.org", role: "admin", note: "Teaches CAD" })).resolves.toEqual({ notified: 1 });
      // A parent (View only) may ask too: it writes notices, never team data.
      await as(parent);
      await expect(suggestTeamInvite(service, { orgId: org, email: "aunt@example.test", role: "viewer" })).resolves.toEqual({ notified: 1 });
      await as(owner);
      const suggestions = (await client.query("SELECT payload FROM notifications WHERE user_id=$1 AND type='invite_suggestion' ORDER BY created_at", [owner])).rows;
      expect(suggestions[0].payload).toMatchObject({ email: "coach@school.org", suggestedRole: "admin", note: "Teaches CAD", fromUserId: student });
      // The student can't read the owner's inbox, and the limit is five an hour.
      await as(student);
      expect((await client.query("SELECT 1 FROM notifications WHERE user_id=$1", [owner])).rowCount).toBe(0);
      for (let i = 0; i < 4; i += 1) await suggestTeamInvite(service, { orgId: org, email: `p${i}@example.test`, role: "scout" });
      await client.query("SAVEPOINT limit_hit");
      await expect(suggestTeamInvite(service, { orgId: org, email: "p9@example.test", role: "scout" })).rejects.toThrow(/five suggestions this hour/);
      await client.query("ROLLBACK TO SAVEPOINT limit_hit");

      // An older email invite for more access raises a member's access when they accept it; it
      // never lowers it, and no "joined" notice is sent for someone already on the team.
      await as(owner);
      const raise = await createOrganizationInvite(service, owner, { orgId: org, email: `${owner}-x@example.test`, role: "scout" });
      expect(raise.inviterName).toBe("Fixture mentor");
      await client.query("RESET ROLE");
      await client.query("INSERT INTO invites(org_id,email,role,token_hash,invited_by,expires_at) VALUES($1,$2,'admin',encode(digest('raise-token-0000000000000000000000000000000','sha256'),'hex'),$3,now()+interval '1 day')", [org, `${parent}@example.test`, owner]);
      await client.query("SET LOCAL ROLE vantage_app");
      await as(parent);
      await acceptOrganizationInvite(service, parent, "raise-token-0000000000000000000000000000000");
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [org, parent])).rows[0].role).toBe("admin");
      await client.query("RESET ROLE");
      expect((await client.query("SELECT 1 FROM notifications WHERE org_id=$1 AND type='invite_accepted' AND payload->>'userId'=$2", [org, parent])).rowCount).toBe(0);
      await client.query("SET LOCAL ROLE vantage_app");

      // The owner removes the student: the student gets a notice with no org, and the no-team
      // screen can name the team.
      await as(owner);
      await removeMember(service, owner, { orgId: org, userId: student });
      await as(student);
      const removal = await latestTeamRemoval(service, student);
      expect(removal).toMatchObject({ orgId: org, removedBy: "Fixture mentor" });
      expect(removal!.team).toContain(`Team ${team}`);
      // A member can't forge a removal notice for someone else.
      await as(parent);
      await client.query("SAVEPOINT forge");
      await expect(
        client.query("INSERT INTO notifications(user_id,org_id,type,payload) VALUES($1,NULL,'team_removed',$2::jsonb)", [owner, JSON.stringify({ orgId: org })]),
      ).rejects.toThrow(/row-level security/);
      await client.query("ROLLBACK TO SAVEPOINT forge");
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  });
});
