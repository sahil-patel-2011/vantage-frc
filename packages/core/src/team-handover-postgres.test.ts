import { randomUUID } from "node:crypto";
import pg from "pg";
import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { claimFrcTeamWorkspace } from "./claim-workspace";
import { createOrganizationInvite } from "./membership";
import { acceptMyOrganizationInvite } from "./membership";
import { handOverTeam } from "./team-handover";
import { setMemberRole } from "./capabilities";

const url = process.env.TEST_DATABASE_ADMIN_URL;
(url ? describe : describe.skip)("real PostgreSQL team lifecycle", () => {
  it("student starts team, lead joins by invitation, handover keeps control and revokes starter administration", async () => {
    const target = new URL(url!);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || !/(?:^|[_-])(test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error("Dedicated local test database required");
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const client = await pool.connect();
    const starter = randomUUID(), lead = randomUUID();
    const service = client as unknown as PoolClient;
    try {
      await client.query("BEGIN");
      for (const [user, role] of [[starter, "student"], [lead, "mentor"]]) {
        await client.query("INSERT INTO users(id,email,name,email_verified) VALUES($1,$2,'Lifecycle fixture',true)", [user, `${user}@example.test`]);
        await client.query("INSERT INTO profiles(user_id,first_name,last_name,date_of_birth,gender,team_role,onboarding_completed_at) VALUES($1,'Lifecycle','Fixture','2000-01-01','prefer_not_to_say',$2,now())", [user, role]);
      }
      const available = await client.query<{ teamNumber: number }>(`SELECT team_number AS "teamNumber" FROM teams_ref t WHERE NOT EXISTS(SELECT 1 FROM organizations o WHERE o.team_number=t.team_number) LIMIT 1`);
      expect(available.rows.length).toBe(1);
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [starter]);
      const orgId = await claimFrcTeamWorkspace(service, starter, { name: "Lifecycle fixture", slug: `fixture-${starter}`, teamNumber: available.rows[0]!.teamNumber });
      await client.query("SELECT set_config('app.org_id',$1,true)", [orgId]);
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, starter])).rows[0].role).toBe("owner");
      // Describing yourself as a mentor alone grants nothing.
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, lead])).rows).toHaveLength(0);
      await createOrganizationInvite(service, starter, { orgId, email: `${lead}@example.test`, role: "admin" });
      await client.query("SELECT set_config('app.user_id',$1,true)", [lead]);
      await acceptMyOrganizationInvite(service, lead, orgId);
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, lead])).rows[0].role).toBe("admin");
      await client.query("SELECT set_config('app.user_id',$1,true)", [starter]);
      await handOverTeam(service, starter, { orgId, userId: lead, role: "scout" });
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, starter])).rows[0].role).toBe("scout");
      await client.query("RESET ROLE");
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, lead])).rows[0].role).toBe("owner");
      expect((await client.query("SELECT action FROM membership_audit_events WHERE org_id=$1 AND action='team.handed_over'", [orgId])).rows).toHaveLength(1);
      await client.query("INSERT INTO membership_capabilities(org_id,user_id,capability,granted_by) VALUES($1,$2,'manage_members',$3)", [orgId, starter, lead]);
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SAVEPOINT delegated_invite");
      await expect(createOrganizationInvite(service, starter, { orgId, email: "delegated-admin@example.test", role: "admin" })).rejects.toThrow(/Only an owner or admin/);
      await client.query("ROLLBACK TO SAVEPOINT delegated_invite");
      await createOrganizationInvite(service, starter, { orgId, email: "delegated-member@example.test", role: "scout" });
      await client.query("SAVEPOINT refused");
      await expect(setMemberRole(service, starter, { orgId, userId: lead, role: "viewer" })).rejects.toThrow(/administrator|Team not found/);
      await client.query("ROLLBACK TO SAVEPOINT refused");
      // The new owner can promote the starter, who can later lower their own access.
      await client.query("SELECT set_config('app.user_id',$1,true)", [lead]);
      await setMemberRole(service, lead, { orgId, userId: starter, role: "admin" });
      await client.query("SELECT set_config('app.user_id',$1,true)", [starter]);
      await setMemberRole(service, starter, { orgId, userId: starter, role: "viewer" });
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, starter])).rows[0].role).toBe("viewer");
      await client.query("RESET ROLE");
      await client.query("UPDATE memberships SET role='admin' WHERE org_id=$1 AND user_id=$2", [orgId, lead]);
      await client.query("SET LOCAL ROLE vantage_app");
      await client.query("SELECT set_config('app.user_id',$1,true)", [lead]);
      await client.query("SAVEPOINT last_admin");
      await expect(setMemberRole(service, lead, { orgId, userId: lead, role: "scout" })).rejects.toThrow(/at least one owner or admin/);
      await client.query("ROLLBACK TO SAVEPOINT last_admin");
      expect((await client.query("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2", [orgId, lead])).rows[0].role).toBe("admin");
    } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
  });
});
