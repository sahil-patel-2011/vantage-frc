import KnowledgeClient from "./knowledge-client";

export default async function TeamKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <KnowledgeClient orgId={orgId} />;
}
