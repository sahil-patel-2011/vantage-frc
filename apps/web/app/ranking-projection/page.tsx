import { computeRankingProjectionView } from "../../lib/ranking-projection/compute-ranking-projection";
import { withPagePaint } from "../../lib/page-org";
import RankingProjectionClient from "./ranking-projection-client";

export const metadata = {
  title: "Ranking projection",
  description: "Where your team is likely to finish, from the matches already saved for this event.",
};

export const dynamic = "force-dynamic";

export default async function RankingProjectionPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const view = await withPagePaint("/ranking-projection", orgId, ({ client, userId, orgId: resolved }) =>
    computeRankingProjectionView(client, { userId, requestedOrg: resolved }),
  );
  return view ? <RankingProjectionClient initial={view} /> : <RankingProjectionClient />;
}
