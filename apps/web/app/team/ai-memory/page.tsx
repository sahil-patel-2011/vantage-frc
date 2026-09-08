import AiMemoryClient from "./ai-memory-client";

export const metadata = {
  title: "Memory",
};

export default async function TeamAiMemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <AiMemoryClient orgId={orgId} />;
}
