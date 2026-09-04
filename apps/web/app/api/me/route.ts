import { auth, listMemberHubAccess } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { isPayingOrgEntitlement } from "../../../lib/paid-plan";
import { resolveTbaConfigured } from "../../../lib/reference/tba-access";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ authenticated: false }, { status: 401 });

    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const profile = await withRls({ userId: session.user.id }, async (client) => {
      const platform = await client.query(`SELECT 1 FROM platform_admins WHERE user_id=$1`, [session.user.id]);
      const memberships = await client.query<{
        orgId: string;
        role: string;
        teamNumber: number | null;
        orgName: string | null;
      }>(
        `SELECT m.org_id AS "orgId", m.role::text AS role, o.team_number AS "teamNumber", o.name AS "orgName"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id=$1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number NULLS LAST, o.name`,
        [session.user.id],
      );
      const activeMembership =
        (requestedOrg
          ? memberships.rows.find((row) => row.orgId === requestedOrg)
          : undefined) ?? memberships.rows[0] ?? null;
      const created = await client.query<{ createdAt: string | null }>(
        `SELECT created_at::text AS "createdAt" FROM users WHERE id=$1`,
        [session.user.id],
      );
      const unread = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM notifications
         WHERE user_id=$1 AND read_at IS NULL`,
        [session.user.id],
      );
      let unreadMessageCount = 0;
      if (activeMembership?.orgId) {
        try {
          const orgId = activeMembership.orgId;
          const unreadMessages = await client.query<{ count: string }>(
            `WITH visible AS (
               SELECT c.id
               FROM org_conversations c
               WHERE c.org_id = $1
                 AND (
                   c.kind = 'team'
                   OR EXISTS (
                     SELECT 1 FROM org_conversation_participants p
                     WHERE p.conversation_id = c.id AND p.user_id = $2
                   )
                 )
             ),
             reads AS (
               SELECT conversation_id, last_read_at
               FROM org_conversation_participants
               WHERE user_id = $2
             )
             SELECT count(*)::text AS count
             FROM org_messages m
             INNER JOIN visible v ON v.id = m.conversation_id
             LEFT JOIN reads r ON r.conversation_id = m.conversation_id
             WHERE m.deleted_at IS NULL
               AND m.author_user_id <> $2
               AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)`,
            [orgId, session.user.id],
          );
          unreadMessageCount = Number(unreadMessages.rows[0]?.count ?? 0);
        } catch {
          unreadMessageCount = 0;
        }
      }
      const profileRow = await client.query<{
        firstName: string | null;
        displayName: string | null;
        preferredTeamNumber: number | null;
        primaryFocus: string | null;
        teamRole: string | null;
        crewRole: string | null;
        onboardingCompletedAt: string | null;
      }>(
        `SELECT first_name AS "firstName",
                display_name AS "displayName",
                preferred_team_number AS "preferredTeamNumber",
                primary_focus AS "primaryFocus",
                team_role AS "teamRole",
                crew_role AS "crewRole",
                onboarding_completed_at::text AS "onboardingCompletedAt"
         FROM profiles WHERE user_id=$1`,
        [session.user.id],
      );
      const tba = await resolveTbaConfigured(client, activeMembership?.orgId ?? null);
      let planCode: string | null = null;
      let planStatus: string | null = null;
      let hubAccess: Awaited<ReturnType<typeof listMemberHubAccess>> = [];
      let teamAffiliation: string | null = null;
      let schoolFunded: boolean | null = null;
      let outsideGrants: boolean | null = null;
      let sponsorsAllowed: boolean | null = null;
      if (activeMembership?.orgId) {
        try {
          const entitlement = await client.query<{ planCode: string; status: string }>(
            `SELECT e.plan_code AS "planCode", e.status
             FROM org_entitlements e
             WHERE e.org_id = $1::uuid
             LIMIT 1`,
            [activeMembership.orgId],
          );
          planCode = entitlement.rows[0]?.planCode ?? null;
          planStatus = entitlement.rows[0]?.status ?? null;
        } catch {
          planCode = null;
          planStatus = null;
        }
        try {
          if (activeMembership.role === "owner" || activeMembership.role === "admin") {
            hubAccess = [];
          } else {
            hubAccess = await listMemberHubAccess(client, activeMembership.orgId, session.user.id);
          }
        } catch {
          hubAccess = [];
        }
        try {
          const funding = await client.query<{
            teamAffiliation: string | null;
            schoolFunded: boolean | null;
            outsideGrants: boolean | null;
            sponsorsAllowed: boolean | null;
          }>(
            `SELECT team_affiliation AS "teamAffiliation",
                    school_funded AS "schoolFunded",
                    outside_grants AS "outsideGrants",
                    sponsors_allowed AS "sponsorsAllowed"
             FROM organizations WHERE id = $1::uuid`,
            [activeMembership.orgId],
          );
          const row = funding.rows[0];
          teamAffiliation = row?.teamAffiliation ?? null;
          schoolFunded = row?.schoolFunded ?? null;
          outsideGrants = row?.outsideGrants ?? null;
          sponsorsAllowed = row?.sponsorsAllowed ?? null;
        } catch {
          teamAffiliation = null;
          schoolFunded = null;
          outsideGrants = null;
          sponsorsAllowed = null;
        }
      }
      return {
        platformAdmin: Boolean(platform.rowCount),
        membership: activeMembership,
        // Real memberships only — never invent DEMO organizations for the Soft-UI picker.
        memberships: memberships.rows.map((row) => ({
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
        })),
        memberSince: created.rows[0]?.createdAt ?? null,
        unreadNotificationCount: Number(unread.rows[0]?.count ?? 0),
        unreadMessageCount,
        profile: profileRow.rows[0] ?? null,
        tbaConfigured: tba.tbaConfigured,
        planCode,
        planStatus,
        paidOrg: isPayingOrgEntitlement({ planCode, status: planStatus }),
        hubAccess,
        teamAffiliation,
        schoolFunded,
        outsideGrants,
        sponsorsAllowed,
      };
    });

    const displayName =
      profile.profile?.displayName?.trim() ||
      session.user.name?.trim() ||
      null;
    const displayFirst =
      profile.profile?.firstName?.trim() ||
      (displayName ?? "").split(" ")[0] ||
      null;

    return Response.json({
      authenticated: true,
      userId: session.user.id,
      name: displayName,
      displayName,
      firstName: displayFirst,
      email: session.user.email,
      image: session.user.image,
      orgId: profile.membership?.orgId ?? null,
      teamNumber: profile.membership?.teamNumber ?? profile.profile?.preferredTeamNumber ?? null,
      orgName: profile.membership?.orgName ?? null,
      role: profile.membership?.role ?? null,
      memberships: profile.memberships,
      platformAdmin: profile.platformAdmin,
      memberSince: profile.memberSince,
      unreadNotificationCount: profile.unreadNotificationCount,
      unreadMessageCount: profile.unreadMessageCount,
      onboardingComplete: Boolean(profile.profile?.onboardingCompletedAt),
      primaryFocus: profile.profile?.primaryFocus ?? "competition",
      teamRole: profile.profile?.teamRole ?? null,
      crewRole: profile.profile?.crewRole ?? null,
      tbaConfigured: profile.tbaConfigured,
      planCode: profile.planCode,
      planStatus: profile.planStatus,
      paidOrg: profile.paidOrg,
      hubAccess: profile.hubAccess,
      teamAffiliation: profile.teamAffiliation,
      schoolFunded: profile.schoolFunded,
      outsideGrants: profile.outsideGrants,
      sponsorsAllowed: profile.sponsorsAllowed,
    });
  } catch {
    return Response.json({ authenticated: false }, { status: 401 });
  }
}
