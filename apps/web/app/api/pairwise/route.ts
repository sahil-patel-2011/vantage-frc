import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  addPairwiseComparison,
  computePairwiseView,
  currentPairwiseSeason,
  deletePairwiseComparison,
  type PairwiseView,
} from "../../../lib/pairwise/compute-pairwise";
import { promotePairwiseOrder } from "../../../lib/pairwise/promote-to-pick-list";

const FALLBACK: PairwiseView = {
  status: "setup_required",
  message: "Could not load pairwise ranking. Choose your team and confirm database access.",
  steps: [{ id: "workspace", label: "Choose your team", detail: "Choose which FRC team you are working as.", href: "/workspace" }],
  orgId: null,
  seasonYear: currentPairwiseSeason(),
};

function uuidOrNull(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const criterionId = url.searchParams.get("criterionId");
  try {
    const view = await withRls({ userId: session.user.id }, (client) =>
      computePairwiseView(client, { userId: session.user.id, requestedOrg, criterionId }),
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
  const orgId = uuidOrNull(body.orgId);
  if (!orgId) return Response.json({ error: "orgId is required" }, { status: 400 });
  const action = typeof body.action === "string" ? body.action : "";
  const criterionId = uuidOrNull(body.criterionId);

  try {
    const view = await withRls({ userId: session.user.id, orgId }, async (client) => {
      const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`, [
        orgId,
        session.user.id,
      ]);
      if (!member.rowCount) throw new Error("Organization access denied");
      if (action === "compare") {
        if (!criterionId) throw new Error("Choose a qualitative criterion first.");
        await addPairwiseComparison(client, {
          orgId,
          userId: session.user.id,
          criterionId,
          winnerTeamNumber: body.winnerTeamNumber,
          loserTeamNumber: body.loserTeamNumber,
          notes: body.notes,
        });
        return computePairwiseView(client, { userId: session.user.id, requestedOrg: orgId, criterionId });
      }
      if (action === "delete") {
        const comparisonId = uuidOrNull(body.comparisonId);
        if (!comparisonId) throw new Error("comparisonId is required");
        await deletePairwiseComparison(client, { orgId, comparisonId });
        return computePairwiseView(client, { userId: session.user.id, requestedOrg: orgId, criterionId });
      }
      if (action === "promote-to-pick-list" || action === "save-to-pick-list") {
        const current = await computePairwiseView(client, {
          userId: session.user.id,
          requestedOrg: orgId,
          criterionId,
        });
        if (current.status !== "live") throw new Error(current.message);
        const criterion = current.criteria.find((row) => row.id === current.criterionId);
        const promotion = await promotePairwiseOrder(client, {
          orgId,
          userId: session.user.id,
          eventKey: current.eventKey,
          ranks: current.ranks,
          criterionName: criterion?.name ?? null,
          bucket: body.bucket,
        });
        if (!promotion.promoted.length) throw new Error(promotion.message);
        const next = await computePairwiseView(client, {
          userId: session.user.id,
          requestedOrg: orgId,
          criterionId,
        });
        return { ...next, promotion };
      }
      throw new Error("Unknown pairwise action");
    });
    return Response.json(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pairwise write failed";
    if (message === "Organization access denied") return Response.json({ error: message }, { status: 403 });
    if (/required|criterion|team number|outrank|Unknown pairwise|active event|Nothing to promote/i.test(message)) {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json(FALLBACK);
  }
}
