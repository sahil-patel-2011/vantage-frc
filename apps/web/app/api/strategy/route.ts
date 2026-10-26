import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { after } from "next/server";
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

export async function loadStrategyView(input: {
  userId: string;
  requestedOrg: string | null;
  matchKey: string | null;
  refresh: boolean;
}): Promise<StrategyView> {
  try {
    after(() => hydrateOrgActiveEvent({ userId: input.userId, requestedOrg: input.requestedOrg }));
  } catch {
    // Called outside a request. The plan still reads stored matches.
  }
  return withRls({ userId: input.userId, orgId: input.requestedOrg ?? undefined }, async (client) => {
    const strategyP = input.refresh
      ? recomputeStrategyView(client, {
          userId: input.userId,
          requestedOrg: input.requestedOrg,
          matchKey: input.matchKey,
        })
      : computeStrategyView(client, {
          userId: input.userId,
          requestedOrg: input.requestedOrg,
          matchKey: input.matchKey,
          readOnly: true,
        });
    const healthP = loadDataSourceHealth(client, input.requestedOrg);
    const [strategy, dataSourceHealth] = await Promise.all([strategyP, healthP]);
    const view = input.refresh ? strategy : finalizeStrategyRecompute(strategy);
    return { ...view, dataSourceHealth };
  });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const matchKey = url.searchParams.get("matchKey");
  const refresh = briefingRequestsStrategyRefresh({ refresh: url.searchParams.get("refresh") });

  try {
    // Compute from saved reference data; ?refresh=1 requests a recompute.
    const view = await loadStrategyView({
      userId: session.user.id,
      requestedOrg,
      matchKey,
      refresh,
    });
    return Response.json(view);
  } catch (error) {
    // A failed read is not proof that the team or active event is missing.
    console.error("strategy load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "The match plan couldn't load from your team's saved data. Try again; your active event has not been cleared." }, { status: 503 });
  }
}

/** Explicit on-demand recompute — briefing POST { action: "recompute" } or { refresh: true }. */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Your session ended. Sign in again." }, { status: 401 });

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
  } catch (error) {
    // Server log only: the member sees the setup card below.
    console.error("strategy load failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "Could not refresh this match plan from saved rankings." }, { status: 400 });
  }
}
