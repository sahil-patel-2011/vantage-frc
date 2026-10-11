import type { Metadata } from "next";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import BuildHub from "./build-hub";

type Props = { searchParams: Promise<{ tab?: string }> };

const description = "Kickoff, CAD, code, and the robot.";

/** "Code · Build", "CAD · Build": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("build", tab), description };
}

export default async function BuildPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <BuildHub initialTab={tab ?? null} />;
}
