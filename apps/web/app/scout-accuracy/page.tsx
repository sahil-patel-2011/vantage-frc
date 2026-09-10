import { EmptyState, PageHeader } from "../../components/ui";
import {
  SCOUT_ACCURACY_RELATED_INCLUDE,
  scoutAccuracyRelatedLinks,
  scoutAccuracySetupSteps,
  scoutAccuracyShellCopy,
} from "../../lib/scout-accuracy/scout-accuracy-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import ScoutAccuracyClient from "./scout-accuracy-client";
import "./scout-accuracy.css";

export const metadata = {
  title: "Scout Accuracy",
};

export default async function ScoutAccuracyPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutAccuracyShellCopy("setup");
    const related = scoutAccuracyRelatedLinks(null, {
      include: [...SCOUT_ACCURACY_RELATED_INCLUDE],
    });
    const steps = scoutAccuracySetupSteps(null);
    return (
      <main className="module-page scout-accuracy-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Scout Accuracy"
          title="Scout Accuracy"
          description={copy.description}
        >
          <nav
            className="product-hub-related scout-accuracy-related"
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
            Choose your team
          </a>
        </EmptyState>
        <section className="app-card soft-panel scout-accuracy-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="scout-accuracy-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted scout-accuracy-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </section>
        <p className="app-muted scout-accuracy-footer-links">
          Also see <a href={withOrgHref("/scouting/lineup", null)}>Coverage</a>
        </p>
      </main>
    );
  }
  return <ScoutAccuracyClient orgId={orgId} />;
}
