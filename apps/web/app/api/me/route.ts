import { auth, listMemberHubAccess } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import { headers } from "next/headers";
import { isPayingOrgEntitlement } from "../../../lib/paid-plan";
import { resolveTbaConfigured } from "../../../lib/reference/tba-access";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ authenticated: false }, { status: 401 });

    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const profile = await withRls({ userId: session.user.id }, async (client) => {
      // The shell reads /api/me on every page load: the admin flag, account age,
      // unread-notification count and profile arrive in ONE round trip (they
      // were four sequential queries). Each is still its own RLS-scoped read.
      const self = await client.query<{
        platformAdmin: boolean;
        createdAt: string | null;
        unreadCount: string;
        firstName: string | null;
        displayName: string | null;
        preferredTeamNumber: number | null;
        primaryFocus: string | null;
        teamRole: string | null;
        onboardingCompletedAt: string | null;
        hasProfile: boolean;
      }>(
        `SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id=$1::uuid) AS "platformAdmin",
                (SELECT created_at::text FROM users WHERE id=$1::uuid) AS "createdAt",
                (SELECT count(*)::text FROM notifications
                 WHERE user_id=$1::uuid AND read_at IS NULL) AS "unreadCount",
                p.first_name AS "firstName",
                p.display_name AS "displayName",
                p.preferred_team_number AS "preferredTeamNumber",
                p.primary_focus AS "primaryFocus",
                p.team_role AS "teamRole",
                p.onboarding_completed_at::text AS "onboardingCompletedAt",
                (p.user_id IS NOT NULL) AS "hasProfile"
         FROM (SELECT 1) AS one
         LEFT JOIN profiles p ON p.user_id=$1::uuid`,
        [session.user.id],
      );
      const selfRow = self.rows[0];
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
      let unreadMessageCount = 0;
      if (activeMembership?.orgId) {
        // A savepoint, not a bare try/catch: a failed read here (chat tables
        // missing on a fresh deploy) would otherwise abort the request's
        // transaction and take every later read in /api/me down with it.
        const orgId = activeMembership.orgId;
        unreadMessageCount = await withSavepoint(client, async () => {
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
          return Number(unreadMessages.rows[0]?.count ?? 0);
        }, 0);
      }
      const tba = await resolveTbaConfigured(client, activeMembership?.orgId ?? null);
      let planCode: string | null = null;
      let planStatus: string | null = null;
      let hubAccess: Awaited<ReturnType<typeof listMemberHubAccess>> = [];
      let teamAffiliation: string | null = null;
      let schoolFunded: boolean | null = null;
      let outsideGrants: boolean | null = null;
      let sponsorsAllowed: boolean | null = null;
      if (activeMembership?.orgId) {
        // Three tolerant reads in a row, on one transaction. Whichever failed
        // first used to abort it, so the two after it silently returned their
        // fallbacks too: /api/me — the endpoint the whole shell reads — reported
        // no plan, no hub access and no funding profile at once, from a 200,
        // because one of the three was unavailable. Each takes a savepoint now.
        const entitlement = await withSavepoint(
          client,
          () =>
            client.query<{ planCode: string; status: string }>(
              `SELECT e.plan_code AS "planCode", e.status
               FROM org_entitlements e
               WHERE e.org_id = $1::uuid
               LIMIT 1`,
              [activeMembership.orgId],
            ),
          null,
        );
        planCode = entitlement?.rows[0]?.planCode ?? null;
        planStatus = entitlement?.rows[0]?.status ?? null;

        hubAccess =
          activeMembership.role === "owner" || activeMembership.role === "admin"
            ? []
            : await withSavepoint(
                client,
                () => listMemberHubAccess(client, activeMembership.orgId, session.user.id),
                [],
              );

        const funding = await withSavepoint(
          client,
          () =>
            client.query<{
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
            ),
          null,
        );
        const row = funding?.rows[0];
        teamAffiliation = row?.teamAffiliation ?? null;
        schoolFunded = row?.schoolFunded ?? null;
        outsideGrants = row?.outsideGrants ?? null;
        sponsorsAllowed = row?.sponsorsAllowed ?? null;
      }
      return {
        platformAdmin: Boolean(selfRow?.platformAdmin),
        membership: activeMembership,
        // Real memberships only — never invent DEMO organizations for the Soft-UI picker.
        memberships: memberships.rows.map((row) => ({
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
        })),
        memberSince: selfRow?.createdAt ?? null,
        unreadNotificationCount: Number(selfRow?.unreadCount ?? 0),
        unreadMessageCount,
        profile: selfRow?.hasProfile
          ? {
              firstName: selfRow.firstName,
              displayName: selfRow.displayName,
              preferredTeamNumber: selfRow.preferredTeamNumber,
              primaryFocus: selfRow.primaryFocus,
              teamRole: selfRow.teamRole,
              onboardingCompletedAt: selfRow.onboardingCompletedAt,
            }
          : null,
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
