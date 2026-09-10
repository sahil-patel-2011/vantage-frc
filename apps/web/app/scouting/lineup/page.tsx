import { EmptyState, PageHeader } from "../../../components/ui";
import {
  LINEUP_RELATED_INCLUDE,
  lineupNextActions,
  lineupRelatedLinks,
  lineupSetupSteps,
  lineupShellCopy,
} from "../../../lib/scouting/lineup-related";
import { withOrgHref } from "../../../lib/nav/product-nav";
import LineupClient from "./lineup-client";
import "./lineup.css";

export const metadata = {
  title: "Lineup & coverage",
};

export default async function ScoutingLineupPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = lineupShellCopy("setup");
    const actions = lineupNextActions({ orgId: null, shell: "setup" });
    const related = lineupRelatedLinks(null, { include: [...LINEUP_RELATED_INCLUDE] });
    const steps = lineupSetupSteps(null);
    return (
      <main className="module-page lineup-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Lineup & coverage"
          title="Lineup & coverage"
          description={copy.description}
        >
          <nav className="product-hub-related lineup-related" aria-label="Related competition tools">
            {related.map((link) => (
              <a key={link.id} className="app-button secondary" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </PageHeader>
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <a className="app-button" href="/workspace">
            Choose your team
          </a>
        </EmptyState>
        <section className="app-card soft-panel lineup-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="lineup-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted lineup-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="app-card soft-panel edc-next-actions lineup-next-actions"
          aria-label="Next actions"
        >
          <header>
            <h2>Next actions</h2>
            <p className="app-muted">Each one opens the page where you finish the work.</p>
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
        <p className="app-muted lineup-footer-links">
          Also see <a href={withOrgHref("/scout-coverage-live", null)}>Scout Coverage Live</a>
        </p>
      </main>
    );
  }
  return <LineupClient orgId={orgId} />;
}
