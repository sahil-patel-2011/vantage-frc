import type { Metadata } from "next";
import { hubDocumentTitle } from "../../lib/nav/hub-title";
import AiHub, { type AskAiParams } from "./ai-hub";

type Props = {
  searchParams: Promise<{
    tab?: string;
    skill?: string;
    prompt?: string;
    from?: string;
    about?: string;
    sponsorId?: string;
    teamKey?: string;
    matchKey?: string;
    mode?: string;
    source?: string;
    contextId?: string;
  }>;
};

const description = "Ask AI: one assistant for your team, with skills for sponsorships, grants, strategy, the pit and more.";

/** Ask AI is the page itself; the controls tabs keep their own titles ("Controls · AI"). */
function isAssistantTab(tab: string | undefined): boolean {
  return !tab || tab === "chat" || tab === "agent";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { tab } = await searchParams;
  if (isAssistantTab(tab)) return { title: "Ask AI", description };
  if (tab === "writer") return { title: "Writer", description: "Saved drafts and templates from your team profile." };
  return { title: hubDocumentTitle("ai", tab), description };
}

export default async function AiPage({ searchParams }: Props) {
  const { tab, ...rest } = await searchParams;
  const ask: AskAiParams = {
    skill: rest.skill ?? null,
    prompt: rest.prompt ?? "",
    from: rest.from ?? null,
    about: rest.about ?? null,
    sponsorId: rest.sponsorId ?? null,
    teamKey: rest.teamKey ?? null,
    matchKey: rest.matchKey ?? null,
    mode: rest.mode === "background" || tab === "agent" ? "background" : null,
    source: rest.source ?? "",
    contextId: rest.contextId ?? "",
  };
  return <AiHub initialTab={tab ?? null} ask={ask} />;
}
