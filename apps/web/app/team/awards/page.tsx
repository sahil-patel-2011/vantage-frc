import AwardsClient from "./awards-client";

export default async function AwardsPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <AwardsClient orgId={orgId} />;
}
