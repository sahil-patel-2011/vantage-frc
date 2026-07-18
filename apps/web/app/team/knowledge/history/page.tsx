import KnowledgeHistoryClient from "./history-client";

export default async function TeamKnowledgeHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <KnowledgeHistoryClient orgId={orgId} />;
}
