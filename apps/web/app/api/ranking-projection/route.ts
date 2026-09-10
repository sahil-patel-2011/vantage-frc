import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { hydrateOrgActiveEvent } from "../../../lib/reference/hydrate-active-event";
import {
  computeRankingProjectionView,
  type RankingProjectionView,
} from "../../../lib/ranking-projection/compute-ranking-projection";

const FALLBACK: RankingProjectionView = {
  status: "setup_required",
  message: "Could not load ranking projection. Choose your team and confirm database access.",
  steps: [{ id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" }],
  orgId: null,
};

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const requestedOrg = new URL(request.url).searchParams.get("orgId");
  try {
    await hydrateOrgActiveEvent({ userId: session.user.id, requestedOrg });
    const view = await withRls({ userId: session.user.id }, (client) =>
      computeRankingProjectionView(client, { userId: session.user.id, requestedOrg }),
    );
    return Response.json(view);
  } catch {
    return Response.json(FALLBACK);
  }
}
