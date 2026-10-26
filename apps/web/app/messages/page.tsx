import { loadMessagesHome } from "../api/messages/route";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { parseComposerLinkFromSearch } from "../../lib/messages/object-links";
import { withPagePaint } from "../../lib/page-org";
import MessagesClient from "./messages-client";

export const metadata = {
  title: "Chat",
};

export const dynamic = "force-dynamic";

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
  const paint = await withPagePaint("/messages", params.orgId, async ({ client, userId, orgId }) => {
    if (!orgId) return null;
    const home = await loadMessagesHome(client, orgId, userId);
    return { orgId, home };
  });
  if (!paint) {
    return (
      <main className="module-page">
        <PageHeader breadcrumbs="Team / Chat" title="Chat" />
        <EmptyState
          title="Choose your team"
          description="Choose your team to open chat."
          badge="Needs setup"
          badgeTone="setup"
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }
  const initialObjectLink = parseComposerLinkFromSearch(new URLSearchParams(params as Record<string, string>), paint.orgId);
  return (
    <MessagesClient
      orgId={paint.orgId}
      initialConversationId={params.conversationId ?? null}
      initialObjectLink={initialObjectLink}
      initialInbox={paint.home}
    />
  );
}
