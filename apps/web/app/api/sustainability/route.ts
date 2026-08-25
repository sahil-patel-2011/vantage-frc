// Sustainability early-warning API. Read-only by design: there is no score to write and no
// denormalized counter to keep in sync — the level is recomputed from recorded rows on every
// request, so it can never drift from the finance desk a mentor is actually looking at.

import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { computeSustainabilityView } from "../../../lib/sustainability/compute-sustainability";

export const runtime = "nodejs";

function validSeason(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 2000 && parsed <= 3000 ? parsed : undefined;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const seasonYear = validSeason(url.searchParams.get("season"));

  try {
    const view = await withRls(
      { userId: session.user.id, orgId: requestedOrg ?? undefined },
      (client) =>
        computeSustainabilityView(client, {
          userId: session.user.id,
          requestedOrg,
          seasonYear,
        }),
    );
    return Response.json(view);
  } catch (error) {
    // A database without the finance/grant-calendar migrations is a setup state, not a
    // failure — the panel should say "record this", never show a fabricated level.
    if (
      error instanceof Error &&
      /finance_funding_sources|grant_calendar_opportunities|grant_applications|team_background_profile|pipeline_stage/.test(
        error.message,
      )
    ) {
      return Response.json({
        status: "setup_required",
        message:
          "The finance and grant calendar migrations have not been applied to this database yet. Your sustainability signal appears once they run.",
        steps: [],
        orgId: null,
      });
    }
    return Response.json(
      { error: "Could not read your sustainability signal." },
      { status: 500 },
    );
  }
}
