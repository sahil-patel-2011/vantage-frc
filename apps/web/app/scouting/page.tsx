import ScoutingClient from "./scouting-client";

export default async function ScoutingPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content soft-gate">
        <span className="eyebrow">VANTAGE / SCOUT</span>
        <h1>Select a workspace</h1>
        <p>Open scouting from your team workspace so the active event can be cached for offline match and pit entry.</p>
        <a href="/workspace">Select workspace</a>
      </main>
    );
  }
  return <ScoutingClient orgId={orgId} />;
}
