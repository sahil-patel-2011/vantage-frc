import { notFound } from "next/navigation";
import RankingProjectionClient from "../ranking-projection-client";
import { previewRankingProjection } from "./preview-states";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Ranking projection",
  description: "Where your team is likely to finish, from the matches already saved for this event.",
};

/**
 * Dev-only screen for the five ranking-projection states.
 * Production and any server without the local auth fixture answer 404.
 */
export default async function RankingProjectionPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV === "production" || process.env.E2E_AUTH_FIXTURE !== "1") notFound();
  const { state } = await searchParams;
  return <RankingProjectionClient initial={previewRankingProjection(state)} />;
}
