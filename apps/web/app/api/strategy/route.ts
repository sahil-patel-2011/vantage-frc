import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { platformTbaEnvConfigured } from "@vantage/reference";
import { loadDataSourceHealth } from "../../../lib/reference-health";
import { computeStrategyView } from "../../../lib/strategy/compute-strategy";
import {
  briefingRequestsStrategyRefresh,
  finalizeStrategyRecompute,
  recomputeStrategyView,
} from "../../../lib/strategy/recompute";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";
import type { StrategyView } from "../../../lib/strategy/types";

export type { StrategyView };

async function loadStrategyView(input: {
  userId: string;
  requestedOrg: string | null;
  matchKey: string | null;
  refresh: boolean;
}): Promise<StrategyView> {
  await hydrateOrgActiveEvent({ userId: input.userId, requestedOrg: input.requestedOrg });
  return withRls({ userId: input.userId }, async (client) => {
    const compute = input.refresh ? recomputeStrategyView : computeStrategyView;
    const strategy = await compute(client, {
      userId: input.userId,
      requestedOrg: input.requestedOrg,
      matchKey: input.matchKey,
    });
    const view = input.refresh ? strategy : finalizeStrategyRecompute(strategy);
    const dataSourceHealth = await loadDataSourceHealth(client, view.orgId);
    return { ...view, dataSourceHealth };
  });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const matchKey = url.searchParams.get("matchKey");
  const tbaConfigured = platformTbaEnvConfigured();
  const refresh = briefingRequestsStrategyRefresh({ refresh: url.searchParams.get("refresh") });

  try {
    // Load computes from Neon last-good cache; ?refresh=1 is the briefing on-demand recompute.
    const view = await loadStrategyView({
      userId: session.user.id,
      requestedOrg,
      matchKey,
      refresh,
    });
    return Response.json(view);
  } catch {
    return Response.json(
      {
        status: "setup_required",
        message: "Could not load strategy context. Choose your team and confirm database access.",
        steps: [
          {
            id: "workspace",
            label: "Choose your team",
            detail: "Pick which FRC team you are working as.",
            href: "/workspace",
          },
          {
            id: "event",
            label: "Set active event",
            detail: "Set the active competition context",
            href: "/workspace",
          },
          {
            id: "tba",
            label: "Sync official matches",
            detail: tbaConfigured
              ? "Official match key is set — open Admin → Live Data to sync if stale"
              : "Connect TBA under Team → Data, or ask whoever set up this site to add an official-match key.",
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

/** Explicit on-demand recompute — briefing POST { action: "recompute" } or { refresh: true }. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!briefingRequestsStrategyRefresh(body)) {
    return Response.json({ error: "Unsupported action" }, { status: 400 });
  }

  const requestedOrg = typeof body.orgId === "string" ? body.orgId : null;
  const matchKey = typeof body.matchKey === "string" ? body.matchKey : null;

  try {
    const view = await loadStrategyView({
      userId: session.user.id,
      requestedOrg,
      matchKey,
      refresh: true,
    });
    return Response.json(view);
  } catch {
    return Response.json({ error: "Could not refresh this match plan from saved rankings." }, { status: 400 });
  }
}
