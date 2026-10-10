import { auth } from "@vantage/core";
import { ScoutingRepository } from "@vantage/scouting/repository";
import { headers } from "next/headers";
import { z } from "zod";
import { coverageEventKey } from "../../../../lib/scouting/coverage-request";
import { RequestSecurityError } from "../../../../lib/security/request";
import { loadBootstrapExtras, withMatchStatus } from "../../../../lib/scouting/bootstrap-extras";
import {
  scoutingErrorResponse,
  ScoutingHttpError,
  withScoutingRequest,
} from "../../../../lib/scouting-auth";

export const dynamic = "force-dynamic";

const query = z.object({ orgId: z.string().uuid(), eventKey: coverageEventKey.optional() }).strict();
function failure(error: unknown) {
  const response = error instanceof RequestSecurityError ? Response.json({ error: error.message }, { status: error.status }) :
    error instanceof ScoutingHttpError ? scoutingErrorResponse(error) :
      Response.json({ error: "Scouting is temporarily unavailable. Refresh to try again." }, { status: 503 });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new ScoutingHttpError(401, "Your session ended. Sign in again.");
    const values = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!values.success) throw new RequestSecurityError(400, "Choose a valid team and event.");
    const { orgId, eventKey } = values.data;
    const data = await withScoutingRequest(orgId, async (client) => {
      const selected = eventKey ? await client.query<{ eventKey: string; eventName: string | null }>(
        'SELECT event_key AS "eventKey",name AS "eventName" FROM events_ref WHERE event_key=$1', [eventKey]) : null;
      if (eventKey && !selected?.rows[0]) throw new ScoutingHttpError(404, "This event is not available. Choose another event.");
      const base = await new ScoutingRepository(client).bootstrap(orgId, session.user.id, selected?.rows[0]);
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
    return failure(error);
  }
}
