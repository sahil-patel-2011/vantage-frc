import type { Metadata } from "next";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import TeamHub from "./team-hub";

type Props = { searchParams: Promise<{ tab?: string }> };

const description = "Calendar, chat, people, tasks, and the playbook.";

/** "Calendar · Team", "Tasks · Team": each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("team", tab), description };
}

export default async function TeamPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <TeamHub initialTab={tab ?? null} />;
}
