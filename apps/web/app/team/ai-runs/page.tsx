import AiRunsClient from "./ai-runs-client";

export const metadata = {
  title: "AI Runs · Team",
};

export default async function TeamAiRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <AiRunsClient orgId={orgId} />;
}
