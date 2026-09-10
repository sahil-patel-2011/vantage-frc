import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  SCOUT_COVERAGE_LIVE_RELATED_INCLUDE,
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
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
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
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
        <section className="app-card soft-panel scout-coverage-live-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="scout-coverage-live-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-coverage-live-tip">{step.detail}</p>
                </div>
                <Button as="a" variant="secondary" href={step.href}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </section>
        <p className="app-muted scout-coverage-live-footer-links">
          Also see <a href={withOrgHref("/scouting/lineup", null)}>Lineup</a>
        </p>
      </main>
    );
  }
  return <ScoutCoverageLiveClient orgId={orgId} />;
}
