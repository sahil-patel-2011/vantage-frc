import ChatClient from "./chat-client";
export default async function ChatPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <ChatClient orgId={orgId} />;
}
