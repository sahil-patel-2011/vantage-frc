import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { getSubteamProgress } from "../../../lib/subteams/store";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

type Membership = { orgId: string; orgName: string; role: string };

async function resolveMembership(
  client: PoolClient,
  userId: string,
  requestedOrgId: string | null,
): Promise<Membership> {
  const result = await client.query<Membership>(
    `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
      WHERE m.user_id = $1::uuid
        AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
      ORDER BY o.name
      LIMIT 1`,
    [userId, requestedOrgId],
  );
  const membership = result.rows[0];
  if (!membership) throw new HttpError(403, "Organization membership required");
  return membership;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new HttpError(401, "Authentication required");
    const requestedOrg = new URL(request.url).searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await resolveMembership(client, session.user.id, requestedOrg);
      const canManage = membership.role === "owner" || membership.role === "admin";

      // get_subteam_progress returns nothing for a non-lead by design, so an
      // empty result would otherwise render as "your team has no members".
      // Say what is actually true instead.
      if (!canManage) {
        return {
          orgId: membership.orgId,
          orgName: membership.orgName,
          canManage,
          progress: null,
        };
      }

      return {
        orgId: membership.orgId,
        orgName: membership.orgName,
        canManage,
        progress: await getSubteamProgress(client, membership.orgId),
      };
    });

    return Response.json(view);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 400;
    return Response.json(
      { error: error instanceof Error ? error.message : "Subteam request failed" },
      { status },
    );
  }
}
