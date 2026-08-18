import { EmptyState, PageHeader } from "../../components/ui";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { parseComposerLinkFromSearch } from "../../lib/messages/object-links";
import MessagesClient from "./messages-client";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{
    orgId?: string;
    conversationId?: string;
    linkType?: string;
    linkId?: string;
    linkLabel?: string;
  }>;
}) {
  const params = await searchParams;
  const { orgId, conversationId } = params;
  const initialObjectLink = orgId
    ? parseComposerLinkFromSearch(new URLSearchParams(params as Record<string, string>), orgId)
    : null;
  if (!orgId) {
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Team chat"
          title="Team chat"
          description="Open team chat from your workspace so org-scoped messages stay in the right tenancy."
        />
        <TeamOpsNav active="messages" />
        <EmptyState
          title="Select a team workspace"
          description="Team and private chats are organization-scoped. Pick a workspace so messages never cross teams."
          badge="Setup"
          badgeTone="setup"
        >
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      </main>
    );
  }
  return (
    <MessagesClient
      orgId={orgId}
      initialConversationId={conversationId ?? null}
      initialObjectLink={initialObjectLink}
    />
  );
}
