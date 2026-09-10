import AwardsClient from "./awards-client";
import "./awards.css";

export const metadata = {
  title: "FIRST award submissions",
};

export default async function AwardsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    return (
      <main className="module-page awards-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Awards workbench</span>
            <h1>Select a workspace</h1>
            <p className="app-muted">
              Award submissions and essay prompts belong to one team. Choose a workspace to open the awards workbench.
            </p>
          </div>
        </header>
        <section className="app-card soft-panel edc-next-actions awards-next-actions" aria-label="Next actions">
          <header>
            <span className="biz-overline">Next actions</span>
            <h2>Open your team workspace</h2>
            <p>Award essays and win status stay blank until this org starts real submissions.</p>
          </header>
          <ol>
            <li className="primary">
              <div>
                <strong>Select workspace</strong>
                <span>Choose your team organization before drafting FIRST award essays.</span>
              </div>
              <a className="app-button secondary" href="/workspace">
                Open
              </a>
            </li>
            <li>
              <div>
                <strong>Business hub</strong>
                <span>Sponsors, Grants, and Awards &amp; evidence live under Business.</span>
              </div>
              <a className="app-button secondary" href="/business">
                Open
              </a>
            </li>
          </ol>
        </section>
      </main>
    );
  }
  return <AwardsClient orgId={orgId} />;
}
