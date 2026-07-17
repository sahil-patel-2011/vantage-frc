import MessagesClient from "./messages-client";

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string; conversationId?: string }>;
}) {
  const { orgId, conversationId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content">
        <h1>Select an organization</h1>
        <p>Open Messages from your team workspace so org-scoped chat stays in the right tenancy.</p>
      </main>
    );
  }
  return <MessagesClient orgId={orgId} initialConversationId={conversationId ?? null} />;
}
