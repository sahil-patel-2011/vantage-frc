import PromptsClient from "./prompts-client";

export default async function TeamPromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <PromptsClient orgId={orgId} />;
}
