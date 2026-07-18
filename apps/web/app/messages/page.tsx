import { EmptyState, PageHeader } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import MessagesClient from "./messages-client";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; conversationId?: string }>;
}) {
  const { orgId, conversationId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Messages"
          title="Messages"
          description="Open Messages from your team workspace so org-scoped chat stays in the right tenancy."
        />
        <TeamOpsNav active="messages" />
        <EmptyState title="Select a team workspace" description="Team and private chats are organization-scoped." badge="Setup" badgeTone="setup">
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return <MessagesClient orgId={orgId} initialConversationId={conversationId ?? null} />;
}
