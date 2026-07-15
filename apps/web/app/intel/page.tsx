import IntelClient from "./intel-client";

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="content">
        <span className="eyebrow">VANTAGE / INTEL</span>
        <h1>Select an organization</h1>
        <p>Open Intel from an organization workspace to prioritize its active event.</p>
      </main>
    );
  }
  return <IntelClient orgId={orgId} />;
}
