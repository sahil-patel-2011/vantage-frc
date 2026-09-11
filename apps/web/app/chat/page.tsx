import { EmptyState, Button } from "../../components/ui";
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
          description="Each team has its own channels and memory. Choose your team, then return from Ask AI."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
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
