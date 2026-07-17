import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { platformTbaEnvConfigured } from "@vantage/reference";
import { computeStrategyView } from "../../../lib/strategy/compute-strategy";
import type { StrategyView } from "../../../lib/strategy/types";

export type { StrategyView };

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const matchKey = url.searchParams.get("matchKey");
  const tbaConfigured = platformTbaEnvConfigured();

  try {
    const view = await withRls({ userId: session.user.id }, async (client) =>
      computeStrategyView(client, {
        userId: session.user.id,
        requestedOrg,
        matchKey,
      }),
    );
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load strategy context. Select a workspace and confirm database access.",
        steps: [
          {
            id: "workspace",
            label: "Select workspace",
            detail: "Choose your team organization",
            href: "/workspace",
          },
          {
            id: "event",
            label: "Select event / location",
            detail: "Set the active competition context",
            href: "/workspace",
          },
          {
            id: "tba",
            label: "Sync TBA",
            detail: tbaConfigured
              ? "Platform TBA key is set — open Admin → Live Data to sync if stale"
              : "Set TBA_AUTH_KEY (or TBA_API_KEY) or save a TBA credential under Team → Data",
            href: "/team/data",
          },
        ],
        orgId: null,
        eventKey: null,
        eventName: null,
        teamNumber: null,
        tbaConfigured,
      } satisfies StrategyView,
      { status: 200 },
    );
  }
}
