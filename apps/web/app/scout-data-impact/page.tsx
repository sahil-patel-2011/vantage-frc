import { EmptyState, PageHeader } from "../../components/ui";
import {
  SCOUT_DATA_IMPACT_RELATED_INCLUDE,
  scoutDataImpactNextActions,
  scoutDataImpactRelatedLinks,
  scoutDataImpactSetupSteps,
  scoutDataImpactShellCopy,
} from "../../lib/scout-data-impact/scout-data-impact-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutDataImpactClient from "./scout-data-impact-client";
import "./scout-data-impact.css";

export const metadata = {
  title: "Scout Data Impact",
};

export default async function ScoutDataImpactPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutDataImpactShellCopy("setup");
    const actions = scoutDataImpactNextActions({ orgId: null, shell: "setup" });
    const related = scoutDataImpactRelatedLinks(null, {
      include: [...SCOUT_DATA_IMPACT_RELATED_INCLUDE],
    });
    const steps = scoutDataImpactSetupSteps(null);
    return (
      <main className="module-page scout-data-impact-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scout Data Impact"
          title="Scout Data Impact"
          description={copy.description}
        >
          <nav
            className="product-hub-related scout-data-impact-related"
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
        <section className="app-card soft-panel scout-data-impact-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Scouting, Strategy, and Accuracy — never DEMO pick credit.</p>
          </header>
          <ul className="scout-data-impact-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-data-impact-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ul>
        </section>
        <section
          className="app-card soft-panel edc-next-actions scout-data-impact-next-actions"
          aria-label="Next actions"
        >
          <header>
            <h2>Next actions</h2>
            <p className="app-muted">Scouting, Strategy, and Accuracy — never DEMO pick credit.</p>
          </header>
          <ol>
            {actions.map((action) => (
              <li key={action.id} className={action.primary ? "primary" : undefined}>
                <div>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </div>
                <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </section>
        <p className="app-muted scout-data-impact-footer-links">
          Also see <a href={withOrgHref("/scout-accuracy", null)}>Accuracy</a>
        </p>
      </main>
    );
  }
  return <ScoutDataImpactClient orgId={orgId} />;
}
