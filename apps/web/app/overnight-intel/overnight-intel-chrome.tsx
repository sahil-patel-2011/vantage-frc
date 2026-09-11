"use client";

import { type ReactNode } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  OVERNIGHT_INTEL_RELATED_INCLUDE,
  overnightIntelRelatedLinks,
  overnightIntelSetupSteps,
  overnightIntelShellCopy,
  type OvernightIntelNextAction,
  type OvernightIntelShellKind,
} from "../../lib/overnight-intel/overnight-intel-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";

export function OvernightRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = overnightIntelRelatedLinks(orgId, {
    include: [...OVERNIGHT_INTEL_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related overnight-intel-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function OvernightNextActionsPanel({ actions }: { actions: OvernightIntelNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions overnight-intel-next-actions"
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

export function OvernightIntelShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  needsActiveEvent,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: OvernightIntelShellKind;
  error?: string;
  onRetry?: () => void;
  needsActiveEvent?: boolean;
  children?: ReactNode;
}) {
  const copy = overnightIntelShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "overnight-intel", orgId);
  const setup = shell === "setup" ? overnightIntelSetupSteps(orgId, { needsActiveEvent })[0] : null;

  return (
    <main className="module-page overnight-intel-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Overnight brief"}
          </>
        }
        title="Overnight brief"
        description={description}
      >
        <OvernightRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "Nothing new yet"
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
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href="#overnight-intel-generate">
            Save tonight&apos;s brief
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}
