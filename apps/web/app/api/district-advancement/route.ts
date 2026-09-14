import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";
import { computeTrajectoryView, saveTrajectoryRun } from "../../../lib/district-trajectory-sim/compute-district-trajectory-sim";
import type { TrajectoryView } from "../../../lib/district-trajectory-sim/compute-district-trajectory-sim";

const FALLBACK: TrajectoryView = {
  status: "setup_required",
  message: "Could not load district advancement. Choose your team and confirm database access.",
  steps: [{ id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" }],
  orgId: null,
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg });
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeTrajectoryView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(FALLBACK);
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const orgId = typeof body.orgId === "string" ? body.orgId : "";
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
        orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("forbidden");
      const live = await computeTrajectoryView(client, { userId: session.user.id, requestedOrg: orgId });
      if (live.status === "live" && live.latestRun && body.action === "save-run") {
        await saveTrajectoryRun(client, {
          orgId,
          userId: session.user.id,
          teamKey: live.teamKey,
          teamNumber: live.teamNumber,
          districtKey: live.districtKey,
          seasonYear: live.seasonYear,
          simRuns: live.latestRun.simRuns,
          baselineEpa: live.latestRun.baselineEpa,
          eventsRemaining: live.latestRun.eventsRemaining,
          qualifyProbability: live.latestRun.qualifyProbability,
          pointsNeeded: live.latestRun.pointsNeeded,
          projectedPointsP10: live.latestRun.projectedPointsP10 ?? 0,
          projectedPointsP50: live.latestRun.projectedPointsP50 ?? 0,
          projectedPointsP90: live.latestRun.projectedPointsP90 ?? 0,
          probabilityCurve: live.latestRun.probabilityCurve,
          scenario: {},
        });
      }
      return computeTrajectoryView(client, { userId: session.user.id, requestedOrg: orgId });
    });
    return Response.json(view);
  } catch {
    return Response.json(FALLBACK);
  }
}
