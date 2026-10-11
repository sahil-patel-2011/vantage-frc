import type { Metadata } from "next";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import AiHub from "./ai-hub";

type Props = { searchParams: Promise<{ tab?: string }> };

const description = "Chat, spend limits, writing help, code assist, and team memory.";

/** "Chat · AI" and so on: each tab is its own page in the tab strip. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  return { title: hubDocumentTitle("ai", tab), description };
}

export default async function AiPage({ searchParams }: Props) {
  const { tab } = await searchParams;
  return <AiHub initialTab={tab ?? null} />;
}
