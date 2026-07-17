import IntelClient from "./intel-client";

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content soft-gate">
        <span className="eyebrow">VANTAGE / INTEL</span>
        <h1>Select a workspace</h1>
        <p>Open Intel from a team workspace to prioritize teams at your active event — no fabricated EPA or ranks.</p>
        <a href="/workspace">Select workspace</a>
      </main>
    );
  }
  return <IntelClient orgId={orgId} />;
}
