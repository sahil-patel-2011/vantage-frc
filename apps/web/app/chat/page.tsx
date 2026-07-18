import ChatClient from "./chat-client";
import "./chat.css";

export const metadata = {
  title: "FRC Assistant · Vantage",
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
      <main className="module-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">AI / Assistant</span>
            <h1>Select a workspace</h1>
            <p className="app-muted">Open the assistant from a team workspace so tools and memory stay org-scoped.</p>
          </div>
        </header>
        <section className="app-card" style={{ display: "grid", gap: 12, justifyItems: "start", padding: 20 }}>
          <span className="app-badge setup">Setup</span>
          <a className="primary-action" href="/workspace">
            Choose workspace →
          </a>
        </section>
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
