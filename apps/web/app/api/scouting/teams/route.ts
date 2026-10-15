import { auth } from "@vantage/core";
import { withRls, withSavepoint } from "@vantage/db";
import { headers } from "next/headers";
import { loadTeamProfiles } from "../../../../lib/scouting/team-profiles";
import { loadScoutingTotals, type ScoutingTotals } from "../../../../lib/scouting/scouted-counts";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../../lib/scout-org-access";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * What this team's scouting says about the robots it watched.
 *
 * Read-only, and org-scoped by `withRls` like every other request path — the
 * whole point is that this is *your* team's view of the field, built from
 * rows only your team can see.
 *
 * `totals` is the event's one set of scouting counts (scouted-counts.ts), the
 * same numbers the pick list, Assignments and Ask AI use, so the Teams header
 * never counts robots its own way. Absent when the totals read failed or there
 * is no event; the screen then falls back to counting the observations.
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
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId");
    if (!orgId) return noStore({ status: "setup_required", message: "Choose your team." }, 200);

    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const profiles = await loadTeamProfiles(client, {
        orgId,
        eventKey: url.searchParams.get("eventKey"),
      });
      if (!profiles.eventKey) return profiles;
      const eventKey = profiles.eventKey;
      const totals = await withSavepoint<ScoutingTotals | null>(
        client,
        () => loadScoutingTotals(client, { orgId, eventKey }),
        null,
      );
      return totals ? { ...profiles, totals } : profiles;
    });
    return noStore(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    const message = publicErrorMessage(error, "Could not load team profiles");
    return Response.json({ error: message }, { status: 500 });
  }
}
