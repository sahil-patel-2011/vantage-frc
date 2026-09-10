import { withOrgHref } from "../../../lib/nav/product-nav";
import {
  TEAM_DATA_RELATED_INCLUDE,
  teamDataNextActions,
  teamDataRelatedLinks,
} from "../../../lib/team-data/team-data-related";
import TeamDataClient from "./team-data-client";
import "./team-data.css";

export const metadata = {
  title: "Team data",
  description:
    "Match-data sync, cache health, and workspace inventory. Links to Schedule, Event Day, and Strategy.",
};

export default async function TeamDataPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const actions = teamDataNextActions({ orgId: null, shell: "setup" });
    const related = teamDataRelatedLinks(null, { include: [...TEAM_DATA_RELATED_INCLUDE] });
    return (
      <main className="module-page team-data-page soft-gate content">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Live data</span>
            <h1>Team Data</h1>
            <p>
              Select a team so TBA sync and inventory stay scoped to the right organization.
            </p>
          </div>
          <nav className="product-hub-related team-data-related" aria-label="Related team data tools">
            {related.map((link) => (
              <a key={link.id} className="app-button secondary" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </header>
        <section className="app-card soft-panel edc-next-actions team-data-next-actions" aria-label="Next actions">
          <header>
            <h2>Next actions</h2>
            <p>Each one opens the page where you finish the work.</p>
          </header>
          <ol>
            {actions.map((action) => (
              <li key={action.id} className={action.primary ? "primary" : undefined}>
                <div>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </div>
                <a className="app-button secondary" href={action.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        </section>
        <p>
          <a className="app-button" href={withOrgHref("/workspace", null)}>
            Choose your team
          </a>
        </p>
      </main>
    );
  }
  return <TeamDataClient orgId={orgId} />;
}
