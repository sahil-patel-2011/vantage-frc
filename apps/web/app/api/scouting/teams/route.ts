import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadTeamProfiles } from "../../../../lib/scouting/team-profiles";
import { isScoutForbidden, scoutForbiddenResponse } from "../../../../lib/scout-org-access";
import { publicErrorMessage } from "../../../../lib/security/public-error";

/**
 * What this team's scouting says about the robots it watched.
 *
 * Read-only, and org-scoped by `withRls` like every other request path — the
 * whole point is that this is *your* team's view of the field, built from
 * rows only your team can see.
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
    if (!orgId) return noStore({ status: "setup_required", message: "Choose your team." }, 200);

    const view = await withRls({ userId: session.user.id, orgId }, async (client) =>
      loadTeamProfiles(client, {
        orgId,
        eventKey: url.searchParams.get("eventKey"),
      }),
    );
    return noStore(view);
  } catch (error) {
    if (isScoutForbidden(error)) return scoutForbiddenResponse();
    const message = publicErrorMessage(error, "Could not load team profiles");
    return Response.json({ error: message }, { status: 500 });
  }
}
