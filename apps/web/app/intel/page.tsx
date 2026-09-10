import { EmptyState, Panel } from "../../components/ui";
import {
  intelSetupSteps,
  intelShellCopy,
} from "../../lib/intel/intel-related";
import { hubHref } from "../../lib/nav/hubs";
import IntelClient from "./intel-client";
import "./intel.css";

export const metadata = {
  title: "Team Intel",
};

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = intelShellCopy("setup");
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
            Choose your team
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
              <p className="app-muted">Finish these once and this page fills in.</p>
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
      </main>
    );
  }
  return <IntelClient orgId={orgId} />;
}
