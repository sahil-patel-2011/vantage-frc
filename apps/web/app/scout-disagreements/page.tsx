import { EmptyState, PageHeader } from "../../components/ui";
import {
  SCOUT_DISAGREEMENTS_RELATED_INCLUDE,
  scoutDisagreementsRelatedLinks,
  scoutDisagreementsSetupSteps,
  scoutDisagreementsShellCopy,
} from "../../lib/scout-disagreements/scout-disagreements-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutDisagreementsClient from "./scout-disagreements-client";
import "./scout-disagreements.css";

export const metadata = {
  title: "Scout Disagreements",
};

export default async function ScoutDisagreementsPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutDisagreementsShellCopy("setup");
    const related = scoutDisagreementsRelatedLinks(null, {
      include: [...SCOUT_DISAGREEMENTS_RELATED_INCLUDE],
    });
    const steps = scoutDisagreementsSetupSteps(null);
    return (
      <main className="module-page scout-disagreements-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scout Disagreements"
          title="Scout Disagreements"
          description={copy.description}
        >
          <nav
            className="product-hub-related scout-disagreements-related"
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
        <section className="app-card soft-panel scout-disagreements-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="scout-disagreements-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-disagreements-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </section>
        <p className="app-muted scout-disagreements-footer-links">
          Also see <a href={withOrgHref("/scout-accuracy", null)}>Accuracy</a>
          {" · "}
          <a href={withOrgHref("/scouting/lineup", null)}>Coverage</a>
        </p>
      </main>
    );
  }
  return <ScoutDisagreementsClient orgId={orgId} />;
}
