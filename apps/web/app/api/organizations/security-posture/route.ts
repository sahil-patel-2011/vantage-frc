import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Read-only security posture summary for org admins: an at-a-glance roll-up of
// the access controls that already exist (auth policy, roles, delegated
// capabilities, pending invites, recent blocked AI calls and policy changes),
// so an admin can spot a weak spot without visiting five different pages. All
// sources are org-scoped tables the member RLS policies already permit reading.

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!session || !orgId) {
      return Response.json(
        { error: "Authentication and organization are required" },
        { status: 401 },
      );
    }
    const data = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const admin = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [orgId, session.user.id],
      );
      if (!admin.rowCount) throw new Error("Organization administrator access required");

      const [roles, authPolicy, invites, delegations, denials, authChanges] = await Promise.all([
        client.query<{ role: string; count: string }>(
          `SELECT role, count(*) AS count FROM memberships WHERE org_id=$1 GROUP BY role`,
          [orgId],
        ),
        client.query(
          `SELECT allow_password AS "allowPassword", allow_google AS "allowGoogle",
                  allow_email_otp AS "allowEmailOtp", mfa_policy AS "mfaPolicy",
                  remembered_device_days AS "rememberedDeviceDays"
           FROM org_auth_policies WHERE org_id=$1`,
          [orgId],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) AS count FROM invites WHERE org_id=$1 AND status='pending'`,
          [orgId],
        ),
        client.query<{ count: string }>(
          `SELECT count(DISTINCT user_id) AS count FROM membership_capabilities WHERE org_id=$1`,
          [orgId],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) AS count FROM api_usage_denials
           WHERE org_id=$1 AND created_at >= now() - interval '7 days'`,
          [orgId],
        ),
        client.query<{ count: string }>(
          `SELECT count(*) AS count FROM auth_policy_audit_events
           WHERE org_id=$1 AND created_at >= now() - interval '30 days'`,
          [orgId],
        ),
      ]);

      const roleCounts: Record<string, number> = {};
      for (const row of roles.rows) roleCounts[row.role] = Number(row.count);

      return {
        roleCounts,
        adminCount: (roleCounts.owner ?? 0) + (roleCounts.admin ?? 0),
        memberCount: roles.rows.reduce((sum, row) => sum + Number(row.count), 0),
        authPolicy: authPolicy.rows[0] ?? {
          allowPassword: false,
          allowGoogle: true,
          allowEmailOtp: true,
          mfaPolicy: "optional",
          rememberedDeviceDays: 14,
          isDefault: true,
        },
        pendingInvites: Number(invites.rows[0]?.count ?? 0),
        delegatedMembers: Number(delegations.rows[0]?.count ?? 0),
        blockedRequests7d: Number(denials.rows[0]?.count ?? 0),
        authChanges30d: Number(authChanges.rows[0]?.count ?? 0),
      };
    });
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Security posture request failed" },
      { status: 403 },
    );
  }
}
