import type { Metadata } from "next";
import { EmptyState, PageHeader } from "../../components/ui";
import {
  PIT_RELATED_INCLUDE,
  pitNextActions,
  pitRelatedLinks,
  pitSetupSteps,
  pitShellCopy,
} from "../../lib/pit/pit-related";
import "./pit-command.css";
import PitCommandClient from "./pit-command-client";

export const metadata: Metadata = {
  title: "Pit Command — Vantage",
  description:
    "Soft-UI robot release board from logged issues, maintenance, and battery evidence — never DEMO readiness metrics. Links to Batteries, Match checklist, and Event Day.",
};

export default async function PitCommandPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  if (!orgId) {
    const copy = pitShellCopy("setup");
    const steps = pitSetupSteps(null);
    const related = pitRelatedLinks(null, { include: [...PIT_RELATED_INCLUDE] });
    const actions = pitNextActions({ orgId: null, shell: "setup" });
    return (
      <main className="module-page pit-page soft-gate">
        <PageHeader
          breadcrumbs={
            <>
              <a href="/competition">Competition</a>
              {" / Pit command"}
            </>
          }
          title="Pit command"
          description={copy.description}
        >
          {related.length ? (
            <nav className="product-hub-related pit-related" aria-label="Related pit tools">
              {related.map((link) => (
                <a key={link.id} className="app-button secondary" href={link.href}>
                  {link.label}
                </a>
              ))}
            </nav>
          ) : null}
        </PageHeader>
        <ol className="strategy-setup-steps">
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
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title={copy.title}
          description={copy.description}
        >
          <a className="app-button" href="/workspace">
            Open Workspace
          </a>
          <a className="app-button secondary" href="/dashboard">
            Back to dashboard
          </a>
        </EmptyState>
        <section className="app-card soft-panel edc-next-actions pit-next-actions" aria-label="Next actions">
          <header>
            <h2>Next actions</h2>
            <p className="app-muted">
              Batteries, Match checklist, and Event Day — never DEMO release metrics.
            </p>
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
      </main>
    );
  }

  return <PitCommandClient orgId={orgId} />;
}
