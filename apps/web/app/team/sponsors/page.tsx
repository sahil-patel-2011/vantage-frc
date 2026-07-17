import SponsorsClient from "./sponsors-client";

export default async function SponsorsPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) return <main className="content"><h1>Select an organization</h1></main>;
  return <SponsorsClient orgId={orgId} />;
}
