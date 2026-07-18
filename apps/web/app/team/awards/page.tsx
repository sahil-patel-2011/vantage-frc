import "../../business/business.css";
import AwardsClient from "./awards-client";

export default async function AwardsPage({
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
            <span className="breadcrumbs">Team / Business / Awards</span>
            <h1>Awards workbench</h1>
            <p>FIRST award submissions and essay prompts are org-scoped.</p>
          </div>
        </header>
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>Select a workspace</h2>
          <p className="app-muted">Choose a team workspace to open the awards workbench.</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </section>
      </main>
    );
  }
  return <AwardsClient orgId={orgId} />;
}
