import { EmptyState, PageHeader } from "../../components/ui";
import {
  SCOUT_COVERAGE_LIVE_RELATED_INCLUDE,
  scoutCoverageLiveNextActions,
  scoutCoverageLiveRelatedLinks,
  scoutCoverageLiveSetupSteps,
  scoutCoverageLiveShellCopy,
} from "../../lib/scout-coverage-live/scout-coverage-live-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutCoverageLiveClient from "./scout-coverage-live-client";
import "./scout-coverage-live.css";

export const metadata = {
  title: "Scout Coverage Live",
};

export default async function ScoutCoverageLivePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutCoverageLiveShellCopy("setup");
    const actions = scoutCoverageLiveNextActions({ orgId: null, shell: "setup" });
    const related = scoutCoverageLiveRelatedLinks(null, {
      include: [...SCOUT_COVERAGE_LIVE_RELATED_INCLUDE],
    });
    const steps = scoutCoverageLiveSetupSteps(null);
    return (
      <main className="module-page scout-coverage-live-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scout Coverage Live"
          title="Scout Coverage Live"
          description={copy.description}
        >
          <nav
            className="product-hub-related scout-coverage-live-related"
            aria-label="Related competition tools"
          >
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
            Select workspace
          </a>
        </EmptyState>
        <section className="app-card soft-panel scout-coverage-live-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Scouting, Lineup, and Cross-Validation — never DEMO coverage.</p>
          </header>
          <ul className="scout-coverage-live-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-coverage-live-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="app-card soft-panel edc-next-actions scout-coverage-live-next-actions"
          aria-label="Next actions"
        >
          <header>
            <h2>Next actions</h2>
            <p className="app-muted">Scouting, Lineup, and Cross-Validation — never DEMO coverage.</p>
          </header>
          <ol>
            {actions.map((action) => (
              <li key={action.id} className={action.primary ? "primary" : undefined}>
                <div>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </div>
                <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
              </li>
            ))}
          </ol>
        </section>
        <p className="app-muted scout-coverage-live-footer-links">
          Also see <a href={withOrgHref("/scouting/lineup", null)}>Lineup</a>
        </p>
      </main>
    );
  }
  return <ScoutCoverageLiveClient orgId={orgId} />;
}
