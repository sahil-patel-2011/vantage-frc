// Our alliance's scouted autonomous routes and where they would meet (lib/strategy/auto-paths.ts).
// Read under the member's RLS: only this team's own scouting is visible, whatever teams are asked.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { autoRouteConflicts, loadAllianceAutoRoutes } from "../../../../lib/strategy/auto-paths";
import { publicErrorMessage } from "../../../../lib/security/public-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_KEY = /^[0-9]{4}[a-z0-9]{1,16}$/;
const TEAM_KEY = /^frc[0-9]{1,5}$/;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const orgId = url.searchParams.get("orgId") ?? "";
    const eventKey = url.searchParams.get("eventKey") ?? "";
    const teamKeys = (url.searchParams.get("teams") ?? "")
      .split(",")
      .map((key) => key.trim().toLowerCase())
      .filter((key) => TEAM_KEY.test(key))
      .slice(0, 3);
    if (!EVENT_KEY.test(eventKey) || teamKeys.length === 0) {
      return Response.json({ error: "An event and up to three teams are required." }, { status: 400 });
    }
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session || !UUID.test(orgId)) {
      return Response.json({ error: "Sign in and choose a team first." }, { status: 401 });
    }
    const routes = await withRls({ userId: session.user.id, orgId }, (client) =>
      loadAllianceAutoRoutes(client, { orgId, eventKey, teamKeys }),
    );
    return Response.json({ routes, conflicts: autoRouteConflicts(routes) });
  } catch (error) {
    return Response.json({ error: publicErrorMessage(error, "Auto routes unavailable") }, { status: 400 });
  }
}
