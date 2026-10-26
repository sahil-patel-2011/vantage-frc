import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { after } from "next/server";
import { loadEventDayCommand } from "../../../lib/command/load-command";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";
import { loadDataSourceHealth } from "../../../lib/reference-health";
import { publicErrorMessage } from "../../../lib/security/public-error";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const orgId = new URL(request.url).searchParams.get("orgId");
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });

  try {
    try {
      after(() => hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg: orgId }));
    } catch {
      // Called outside a request. Event day still reads the stored schedule.
    }
    const snapshot = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const commandP = loadEventDayCommand(client, { orgId, userId: session.user.id });
      const healthP = loadDataSourceHealth(client, orgId);
      const [command, dataSourceHealth] = await Promise.all([commandP, healthP]);
      return { ...command, dataSourceHealth };
    });
    return Response.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      {
        error: publicErrorMessage(error, "Could not load Event day"),
      },
      { status: 400 },
    );
  }
}
