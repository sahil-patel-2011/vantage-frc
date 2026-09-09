import { EmptyState } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import ChatClient from "./chat-client";
import "./chat.css";

export const metadata = {
  title: "FRC Assistant",
  description: "Ask about teams, matchups, and scout evidence with authorized tools — nothing invented.",
};

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; prompt?: string; source?: string; contextId?: string }>;
}) {
  const { orgId, prompt, source, contextId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page ch-page">
        <EmptyState
          soft
          badge="Setup"
          badgeTone="setup"
          title="Select a team workspace"
          description="Chat channels and memory are org-scoped. Open Workspace or Account, then return from the AI hub."
        >
          <a className="app-button secondary" href="/workspace">
            Open Workspace
          </a>
          <a className="app-button secondary" href={withOrgHref("/account", null)}>
            Account
          </a>
          <a className="app-button secondary" href={hubHref("/ai", "budgets", null)}>
            Budgets
          </a>
          <a className="app-button secondary" href={hubHref("/ai", "memory", null)}>
            Memory
          </a>
          <a className="app-button secondary" href={hubHref("/competition", "strategy", null)}>
            Strategy
          </a>
        </EmptyState>
      </main>
    );
  }
  return (
    <ChatClient
      orgId={orgId}
      initialPrompt={prompt ?? ""}
      source={source ?? ""}
      contextId={contextId ?? ""}
    />
  );
}
