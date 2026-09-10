import { EmptyState, PageHeader } from "../../components/ui";
import {
  SCOUT_CROSSVAL_RELATED_INCLUDE,
  scoutCrossvalRelatedLinks,
  scoutCrossvalSetupSteps,
  scoutCrossvalShellCopy,
} from "../../lib/scout-crossval/scout-crossval-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutCrossvalClient from "./scout-crossval-client";
import "./scout-crossval.css";

export const metadata = {
  title: "Scout Cross-Validation",
};

export default async function ScoutCrossvalPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutCrossvalShellCopy("setup");
    const related = scoutCrossvalRelatedLinks(null, {
      include: [...SCOUT_CROSSVAL_RELATED_INCLUDE],
    });
    const steps = scoutCrossvalSetupSteps(null);
    return (
      <main className="module-page scout-crossval-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scout Cross-Validation"
          title="Scout Cross-Validation"
          description={copy.description}
        >
          <nav className="product-hub-related scout-crossval-related" aria-label="Related competition tools">
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
        <section className="app-card soft-panel scout-crossval-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="scout-crossval-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-crossval-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </section>
        <p className="app-muted scout-crossval-footer-links">
          Also see <a href={withOrgHref("/scout-coverage-live", null)}>Coverage Live</a>
        </p>
      </main>
    );
  }
  return <ScoutCrossvalClient orgId={orgId} />;
}
