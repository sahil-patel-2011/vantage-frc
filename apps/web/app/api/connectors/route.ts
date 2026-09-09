/**
 * Read model for the connectors settings page.
 *
 * GET only. Connect and Disconnect stay on each connector's own endpoint
 * (`/api/github`, `/api/cad/onshape`, `/api/team/discord`, `/api/team/slack`)
 * so there is exactly one implementation of revoking a credential — a second
 * copy of "overwrite the envelope and set disabled_at" is a second place for it
 * to be subtly wrong, and the wrong one leaves a live refresh token in a row
 * that reads as disconnected.
 *
 * `orgId` falls back to the caller's own membership rather than 400-ing. The
 * page is reached from the settings menu with no query string, and answering a
 * settings link with "orgId is required" is the failure this whole change is
 * about.
 */
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  buildConnectorStatuses,
  loadConnectorProofs,
  summarizeConnectors,
} from "../../../lib/connectors/load-connector-status";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

  const requestedOrgId = new URL(request.url).searchParams.get("orgId")?.trim() || null;

  try {
    const resolved = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; role: string }>(
        `SELECT org_id AS "orgId", role::text AS role
         FROM memberships
         WHERE user_id=$1::uuid
           AND ($2::uuid IS NULL OR org_id = $2::uuid)
         ORDER BY CASE role::text WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at ASC
         LIMIT 1`,
        [session.user.id, requestedOrgId],
      );
      return membership.rows[0] ?? null;
    });

    const orgId = resolved?.orgId ?? null;
    const role = resolved?.role ?? null;

    const proofs = orgId
      ? await withRls({ userId: session.user.id, orgId }, (client) =>
          loadConnectorProofs(client, { userId: session.user.id, orgId }),
        )
      : await withRls({ userId: session.user.id }, (client) =>
          loadConnectorProofs(client, { userId: session.user.id, orgId: null }),
        );

    const connectors = buildConnectorStatuses(process.env, proofs);

    return Response.json({
      orgId,
      role,
      /** Only owners and admins may change a team-scoped link. */
      canManage: role === "owner" || role === "admin",
      summary: summarizeConnectors(connectors),
      connectors,
    });
  } catch {
    // A connectors page that 500s is the exact complaint. Answer with the
    // environment-only view, which is still true and still actionable.
    const connectors = buildConnectorStatuses(process.env, {});
    return Response.json({
      orgId: null,
      role: null,
      canManage: false,
      summary: summarizeConnectors(connectors),
      connectors,
      degraded:
        "Could not read this workspace's stored links, so only deployment-level configuration is shown. Anything linked per team is not reflected below.",
    });
  }
}
