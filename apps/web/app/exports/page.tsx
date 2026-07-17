import ExportCenter from "./export-client";
import "./exports.css";

export const metadata = {
  title: "Exports · Vantage",
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
      <main className="module-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Export Center</span>
            <h1>Select an organization</h1>
            <p>Choose a workspace to export scouting, strategy, and ops data.</p>
          </div>
        </header>
        <section className="app-card soft-panel">
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </section>
      </main>
    );
  }
  return <ExportCenter orgId={orgId} />;
}
