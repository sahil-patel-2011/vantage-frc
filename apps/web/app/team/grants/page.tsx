import "../../business/business.css";
import GrantsClient from "./grants-client";

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page business-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Business / Grants</span>
            <h1>Grants workbench</h1>
            <p>Grant opportunities, applications, and essay items are org-scoped.</p>
          </div>
        </header>
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>Select a workspace</h2>
          <p className="app-muted">Choose a team workspace to open the writing workbench.</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </section>
      </main>
    );
  }
  return <GrantsClient orgId={orgId} />;
}
