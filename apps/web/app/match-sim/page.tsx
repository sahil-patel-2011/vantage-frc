import { computeMatchSimView } from "../../lib/match-sim/compute-match-sim";
import { withPagePaint } from "../../lib/page-org";
import MatchSimClient from "./match-sim-client";
import "./match-sim.css";

export const metadata = {
  title: "Match prediction",
};

export const dynamic = "force-dynamic";

export default async function MatchSimPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/match-sim", orgId, ({ client, userId, orgId: resolved }) =>
    computeMatchSimView(client, { userId, requestedOrg: resolved }),
  );
  return <MatchSimClient initial={view} />;
}
