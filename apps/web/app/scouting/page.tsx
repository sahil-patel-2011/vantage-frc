import { EmptyState, Button } from "../../components/ui";
import {
  SCOUTING_RELATED_INCLUDE,
  scoutingNextActions,
  scoutingRelatedLinks,
  scoutingSetupSteps,
  scoutingShellCopy,
} from "../../lib/scouting/scouting-related";
import ScoutingClient from "./scouting-client";
import "./scouting.css";

export const metadata = {
  title: "Scouting",
};

export default async function ScoutingPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = scoutingShellCopy("setup");
    const links = scoutingRelatedLinks(null, { include: [...SCOUTING_RELATED_INCLUDE] });
    const actions = scoutingNextActions({ orgId: null, shell: "setup" });
    const steps = scoutingSetupSteps(null);
    return (
      <main className="module-page scout-page soft-gate">
        <EmptyState
          soft
          className="scout-shell-empty"
          badge={copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
          <nav className="product-hub-related scout-related" aria-label="Related competition tools">
            {links.map((link) => (
              <Button as="a" variant="secondary" key={link.id} href={link.href}>
                {link.label}
              </Button>
            ))}
          </nav>
          <ol className="scout-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
        <section
          className="app-card soft-panel edc-next-actions scout-next-actions"
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
                <Button as="a" variant="secondary" href={action.href}>
                  Open
                </Button>
              </li>
            ))}
          </ol>
        </section>
      </main>
    );
  }
  return <ScoutingClient orgId={orgId} />;
}
