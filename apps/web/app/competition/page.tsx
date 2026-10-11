import type { Metadata } from "next";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import CompetitionHub from "./competition-hub";

type Props = { searchParams: Promise<{ tab?: string }> };

const description = "Event day, scouting, strategy, and pit.";

/** "Scout · Competition", "My Day · Competition": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("competition", tab), description };
}

export default async function CompetitionPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <CompetitionHub initialTab={tab ?? null} />;
}
