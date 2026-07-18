import { EmptyState, Panel } from "../../components/ui";
import {
  intelNextActions,
  intelSetupSteps,
  intelShellCopy,
} from "../../lib/intel/intel-related";
import { hubHref } from "../../lib/nav/hubs";
import IntelClient from "./intel-client";
import "./intel.css";

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = intelShellCopy("setup");
    const actions = intelNextActions({ orgId: null, shell: "setup" });
    const steps = intelSetupSteps(null);
    return (
      <main className="module-page intel-page soft-gate">
        <EmptyState
          soft
          badge={copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <a className="app-button" href="/workspace">
            Select workspace
          </a>
          <a className="app-button secondary" href={hubHref("/competition", "strategy", null)}>
            Open Strategy
          </a>
          <a className="app-button secondary" href="/dossier">
            Open Team Dossier
          </a>
          <a className="app-button secondary" href={hubHref("/competition", "scouting", null)}>
            Open Scouting
          </a>
        </EmptyState>
        {steps.length > 0 ? (
          <Panel className="intel-panel" aria-label="Setup steps">
            <header>
              <h2>Setup steps</h2>
              <p className="app-muted">Strategy, Dossier, and Scouting — never DEMO research.</p>
            </header>
            <ul className="intel-setup-steps">
              {steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <p className="app-muted">{step.detail}</p>
                  </div>
                  <a className="app-button secondary" href={step.href}>
                    Open
                  </a>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
        {actions.length > 0 ? (
          <section
            className="app-card soft-panel edc-next-actions intel-next-actions"
            aria-label="Next actions"
          >
            <header>
              <h2>Next actions</h2>
              <p className="app-muted">Strategy, Dossier, and Scouting — never DEMO research.</p>
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
        ) : null}
      </main>
    );
  }
  return <IntelClient orgId={orgId} />;
}
