import ScoutingClient from "./scouting-client";

export default async function ScoutingPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content">
        <span className="eyebrow">VANTAGE / SCOUT</span>
        <h1>Select an organization</h1>
        <p>Open scouting from your organization workspace to cache its active event.</p>
      </main>
    );
  }
  return <ScoutingClient orgId={orgId} />;
}
