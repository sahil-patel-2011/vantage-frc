// One Pre-Match Briefing — thin route over lib/briefing/compute-briefing.
// All assembly (schedule, prediction reuse, scouting bridge, cards, watchlist,
// defense plans, pit status, robot health, callouts, practice, film) lives in
// the compute so the API, tests, and any future embed share one code path.
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { computeBriefingView } from "../../../lib/briefing/compute-briefing";
import type { FullBriefingView } from "../../../lib/briefing/types";
import { briefingRequestsStrategyRefresh } from "../../../lib/strategy/recompute";

export type { FullBriefingView };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Briefing request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    // Canonical param is matchKey; legacy consolidation links may use ?match=.
    const requestedMatch = url.searchParams.get("matchKey") ?? url.searchParams.get("match");
    const refresh = briefingRequestsStrategyRefresh({ refresh: url.searchParams.get("refresh") });

    const view = await withRls({ userId: session.user.id }, (client) =>
      computeBriefingView(client, { userId: session.user.id, requestedOrg, requestedMatch, refresh }),
    );

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}
