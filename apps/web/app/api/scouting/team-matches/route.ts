import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadTeamMatchLog } from "../../../../lib/scouting/team-match-log-load";
import { isScoutForbidden, resolveScoutOrg, scoutForbiddenResponse } from "../../../../lib/scout-org-access";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * One robot at one event, match by match: alliance, partners, opponents, the
 * official result, what our scouts recorded, notes and video.
 *
 * Read-only and org-scoped by withRls; an explicit foreign orgId is a 403, not
 * an empty table.
 */
function noStore(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    const teamKey = (url.searchParams.get("teamKey") ?? "").trim();
    if (!orgId) return noStore({ status: "empty", message: "Choose your team first." });
    if (!teamKey) return noStore({ status: "empty", message: "Pick a robot to see its matches." });

    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const org = await resolveScoutOrg(client, session.user.id, orgId);
      if (!org) return { status: "empty" as const, message: "Choose your team first." };
      let eventKey = url.searchParams.get("eventKey")?.trim() || null;
      if (!eventKey) {
        const active = await client.query<{ eventKey: string | null }>(
          `SELECT active_event_key AS "eventKey" FROM org_active_context WHERE org_id = $1::uuid`,
          [org.orgId],
        );
        eventKey = active.rows[0]?.eventKey ?? null;
      }
      return loadTeamMatchLog(client, { orgId: org.orgId, eventKey, teamKey });
    });
    return noStore(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    const message = publicErrorMessage(error, "Could not load this robot's matches");
    return Response.json({ error: message }, { status: 500 });
  }
}
