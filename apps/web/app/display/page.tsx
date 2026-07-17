import DisplaySetup from "./setup-client";

export default async function DisplayPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content soft-gate">
        <span className="eyebrow">VANTAGE / DISPLAY</span>
        <h1>Select a workspace</h1>
        <p>Pit TV boards are saved per team. Select a workspace before creating a display layout.</p>
        <a href="/workspace">Select workspace</a>
      </main>
    );
  }
  return <DisplaySetup orgId={orgId} />;
}
