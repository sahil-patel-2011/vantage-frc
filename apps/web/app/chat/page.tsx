import { EmptyState, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import ChatClient from "./chat-client";
import "./chat.css";

export const metadata = {
  title: "FRC Assistant",
  description: "Ask about teams, matchups, and scout evidence with authorized tools.",
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
          title="Choose your team"
          description="Each team has its own channels and memory. Choose your team or Account, then return from the AI hub."
        >
          <Button as="a" variant="secondary" href="/workspace">
            Choose your team
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/account", null)}>
            Account
          </Button>
          <Button as="a" variant="secondary" href={hubHref("/ai", "budgets", null)}>
            Budgets
          </Button>
          <Button as="a" variant="secondary" href={hubHref("/ai", "memory", null)}>
            Memory
          </Button>
          <Button as="a" variant="secondary" href={hubHref("/competition", "strategy", null)}>
            Strategy
          </Button>
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
