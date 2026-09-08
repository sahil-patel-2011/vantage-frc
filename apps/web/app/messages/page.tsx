import { EmptyState, PageHeader } from "../../components/ui";
import { parseComposerLinkFromSearch } from "../../lib/messages/object-links";
import MessagesClient from "./messages-client";

export const metadata = {
  title: "Chat",
};

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
        <PageHeader breadcrumbs="Team / Chat" title="Chat" />
        <EmptyState
          title="Choose a team"
          description="Pick a team to open chat."
          badge="Setup"
          badgeTone="setup"
        >
          <a className="app-button" href="/workspace">
            Choose team
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
