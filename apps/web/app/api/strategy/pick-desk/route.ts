import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { loadDataSourceHealth } from "../../../../lib/reference-health";
import { loadPickDesk } from "../../../../lib/strategy/pick-desk";
import { withIntelRequest, IntelHttpError } from "../../../../lib/intel-auth";
import type { PoolClient } from "@neondatabase/serverless";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId");
  try {
    const work = async (client: PoolClient) => {
      const desk = await loadPickDesk(client, { userId: session.user.id, requestedOrg: orgId });
      const dataSourceHealth = await loadDataSourceHealth(client, desk.orgId);
      return { ...desk, dataSourceHealth };
    };
    const view = orgId ? await withIntelRequest(orgId, work) : await withRls({ userId: session.user.id }, work);
    return Response.json(view, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof IntelHttpError ? error.message : "Could not load the pick list. Try again." }, { status: error instanceof IntelHttpError ? error.status : 503, headers: { "cache-control": "private, no-store" } });
  }
}
