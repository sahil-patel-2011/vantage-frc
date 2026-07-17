import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { resolveTbaConfigured } from "../../../lib/reference/tba-access";

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ authenticated: false }, { status: 401 });

    const profile = await withRls({ userId: session.user.id }, async (client) => {
      const platform = await client.query(`SELECT 1 FROM platform_admins WHERE user_id=$1`, [session.user.id]);
      const membership = await client.query<{
        orgId: string;
        role: string;
        teamNumber: number | null;
        orgName: string | null;
      }>(
        `SELECT m.org_id AS "orgId", m.role, o.team_number AS "teamNumber", o.name AS "orgName"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id=$1
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id],
      );
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
      if (membership.rows[0]?.orgId) {
        try {
          const orgId = membership.rows[0].orgId;
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
        onboardingCompletedAt: string | null;
      }>(
        `SELECT first_name AS "firstName",
                display_name AS "displayName",
                preferred_team_number AS "preferredTeamNumber",
                onboarding_completed_at::text AS "onboardingCompletedAt"
         FROM profiles WHERE user_id=$1`,
        [session.user.id],
      );
      const tba = await resolveTbaConfigured(client, membership.rows[0]?.orgId ?? null);
      return {
        platformAdmin: Boolean(platform.rowCount),
        membership: membership.rows[0] ?? null,
        memberSince: created.rows[0]?.createdAt ?? null,
        unreadNotificationCount: Number(unread.rows[0]?.count ?? 0),
        unreadMessageCount,
        profile: profileRow.rows[0] ?? null,
        tbaConfigured: tba.tbaConfigured,
      };
    });

    const displayFirst =
      profile.profile?.firstName?.trim() ||
      (session.user.name ?? "").split(" ")[0] ||
      null;

    return Response.json({
      authenticated: true,
      name: session.user.name,
      firstName: displayFirst,
      email: session.user.email,
      image: session.user.image,
      orgId: profile.membership?.orgId ?? null,
      teamNumber: profile.membership?.teamNumber ?? profile.profile?.preferredTeamNumber ?? null,
      orgName: profile.membership?.orgName ?? null,
      role: profile.membership?.role ?? null,
      platformAdmin: profile.platformAdmin,
      memberSince: profile.memberSince,
      unreadNotificationCount: profile.unreadNotificationCount,
      unreadMessageCount: profile.unreadMessageCount,
      onboardingComplete: Boolean(profile.profile?.onboardingCompletedAt),
      tbaConfigured: profile.tbaConfigured,
    });
  } catch {
    return Response.json({ authenticated: false }, { status: 401 });
  }
}
