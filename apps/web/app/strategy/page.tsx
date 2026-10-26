import { loadStrategyView } from "../api/strategy/route";
import { requirePageUser } from "../../lib/page-org";
import StrategyClient from "./strategy-client";

export const metadata = {
  title: "Strategy",
};

export const dynamic = "force-dynamic";

export default async function StrategyPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; matchKey?: string }>;
}) {
  const { orgId, matchKey } = await searchParams;
  const user = await requirePageUser("/strategy");
  const view = await loadStrategyView({
    userId: user.id,
    requestedOrg: orgId ?? null,
    matchKey: matchKey ?? null,
    refresh: false,
  }).catch(() => null);
  return <StrategyClient initialView={view} />;
}
