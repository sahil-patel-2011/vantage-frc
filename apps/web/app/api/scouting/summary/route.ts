import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { z } from "zod";
import { loadLeadSummary } from "../../../../lib/scouting/lead-summary-load";
import { RequestSecurityError } from "../../../../lib/security/request";
import { scoutingErrorResponse, ScoutingHttpError, withScoutingRequest } from "../../../../lib/scouting-auth";

export const dynamic = "force-dynamic";

const query = z.object({ orgId: z.string().uuid() }).strict();

function failure(error: unknown) {
  const response =
    error instanceof RequestSecurityError
      ? Response.json({ error: error.message }, { status: error.status })
      : error instanceof ScoutingHttpError
        ? scoutingErrorResponse(error)
        : Response.json({ error: "Scouting numbers are temporarily unavailable. Refresh to try again." }, { status: 503 });
  response.headers.set("cache-control", "private, no-store");
  return response;
}

/** Pit and match coverage at the active event, your own numbers, and (for leads) every scout's. */
export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) throw new ScoutingHttpError(401, "Your session ended. Sign in again.");
    const values = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!values.success) throw new RequestSecurityError(400, "Choose a valid team.");
    const { orgId } = values.data;
    const view = await withScoutingRequest(orgId, (client) => loadLeadSummary(client, { orgId, userId: session.user.id }));
    return Response.json(view, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
