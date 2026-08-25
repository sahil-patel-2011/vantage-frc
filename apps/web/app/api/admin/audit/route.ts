import { assertPlatformAdmin, auth, platformAdminDeniedResponse } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

// Platform control-plane audit log. writeAdminAction() records every
// platform-admin action (trials, gifts, credit packs, provisioning, …) into
// admin_actions, but nothing ever read it back — this is the reader that fills
// the admin "Audit log" surface. RLS restricts admin_actions to platform admins;
// organizations are readable via organizations_platform_read and actor emails
// via users_platform_read (0479). On databases that predate 0479 the email
// LEFT JOIN degrades to NULL and the UI falls back to the actor id.

const LIMIT = 200;

async function runAdmin<T>(work: Parameters<typeof withRls<T>>[1]) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error("Authentication required");
  return withRls({ userId: session.user.id }, async (client) => {
    await assertPlatformAdmin(client);
    return work(client);
  });
}

export async function GET() {
  try {
    return Response.json(
      await runAdmin(async (client) => {
        const [events, byAction] = await Promise.all([
          client.query(
            `SELECT a.id, a.created_at AS "createdAt", a.action, a.payload,
                    a.actor_user_id AS "actorId", actor.email AS "actorEmail",
                    a.target_org_id AS "targetOrgId", o.name AS "targetOrgName",
                    o.team_number AS "targetTeamNumber", a.target_user_id AS "targetUserId"
             FROM admin_actions a
             LEFT JOIN users actor ON actor.id = a.actor_user_id
             LEFT JOIN organizations o ON o.id = a.target_org_id
             ORDER BY a.created_at DESC
             LIMIT ${LIMIT}`,
          ),
          client.query(
            `SELECT action, count(*) AS count FROM admin_actions
             WHERE created_at >= now() - interval '30 days'
             GROUP BY action ORDER BY count DESC`,
          ),
        ]);
        return { events: events.rows, byAction: byAction.rows };
      }),
    );
  } catch (error) {
    return platformAdminDeniedResponse(error);
  }
}
