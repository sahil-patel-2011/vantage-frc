import ExportCenter from "./export-client";
import "./exports.css";

export const metadata = {
  title: "Exports",
  description: "Audited CSV, PDF inventory, and ZIP archives of team data with clear provenance.",
};

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="soft-gate content">
        <span className="eyebrow">Export</span>
        <h1>Select a team</h1>
        <p>Open Export Center from a team so archives stay scoped to the right organization.</p>
        <a href="/dashboard">Go to Home</a>
      </main>
    );
  }
  return <ExportCenter orgId={orgId} />;
}
