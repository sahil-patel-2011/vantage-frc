"use client";

import type { ReactNode } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  INSPECTION_COPILOT_RELATED_INCLUDE,
  inspectionCopilotNextActions,
  inspectionCopilotRelatedLinks,
  inspectionCopilotShellCopy,
  type InspectionCopilotNextAction,
  type InspectionCopilotShellKind,
} from "../../lib/inspection-copilot/inspection-copilot-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

export function InspectionRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = inspectionCopilotRelatedLinks(orgId, {
    include: [...INSPECTION_COPILOT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related inspection-copilot-related" aria-label="Related build tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function InspectionNextActionsPanel({ actions }: { actions: InspectionCopilotNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions inspection-copilot-next-actions"
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
  );
}

export function InspectionShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: InspectionCopilotShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = inspectionCopilotNextActions({ orgId, shell });
  const copy = inspectionCopilotShellCopy(shell);
  const buildHref = hubHref("/build", "fmea", orgId);

  return (
    <main className="module-page inspection-copilot-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Inspection Copilot"}
          </>
        }
        title="Inspection-Readiness Copilot"
        description={description}
      >
        <InspectionRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No checks yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#inspection-copilot-form">Run a check</Button>
        ) : null}
      </EmptyState>
      <InspectionNextActionsPanel actions={actions} />
    </main>
  );
}
