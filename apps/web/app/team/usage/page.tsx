import UsageClient from "./usage-client";

export default async function TeamUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <UsageClient orgId={orgId} />;
}
