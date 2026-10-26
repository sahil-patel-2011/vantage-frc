import { auth } from "@vantage/core";
import { headers } from "next/headers";
import { z } from "zod";
import { coverageEventKey } from "../../../../lib/scouting/coverage-request";
import { loadScoutingBootstrap } from "../../../../lib/scouting/load-bootstrap";
import { RequestSecurityError } from "../../../../lib/security/request";
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
    const data = await withScoutingRequest(orgId, (client) =>
      loadScoutingBootstrap(client, { orgId, userId: session.user.id, eventKey }),
    );
    return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
