import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
import { headers } from "next/headers";
import { loadBootstrapExtras, withMatchStatus } from "../../../../lib/scouting/bootstrap-extras";
import {
  scoutingErrorResponse,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });
    const orgId = new URL(request.url).searchParams.get("orgId");
    const data = await withScoutingRequest(orgId, async (client) => {
      const base = await new ScoutingRepository(client).bootstrap(orgId!, session.user.id);
      // Your own reports (all of them, not the team's latest 30), every robot the team has
      // scouted, and each match's status: see lib/scouting/bootstrap-extras.ts.
      const extras = await loadBootstrapExtras(client, {
        orgId: orgId!,
        userId: session.user.id,
        eventKey: base.eventKey,
      });
      return {
        ...base,
        matches: withMatchStatus(base.matches as Array<{ matchKey: string }>, extras.matchStatus),
        myEntries: extras.myEntries,
        scouted: extras.scouted,
        teamNumber: extras.teamNumber,
      };
    });
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return scoutingErrorResponse(error);
  }
}
