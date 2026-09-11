"use client";

import { type ReactNode } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import {
  INTEL_RELATED_INCLUDE,
  intelRelatedLinks,
  intelSetupSteps,
  intelShellCopy,
  type IntelNextAction,
  type IntelShellKind,
} from "../../lib/intel/intel-related";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

export function IntelRelatedStrip({
  orgId,
  teamNumber,
}: {
  orgId?: string | null;
  teamNumber?: number | null;
}) {
  const links = intelRelatedLinks(orgId, {
    include: [...INTEL_RELATED_INCLUDE],
    teamNumber,
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related intel-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function IntelNextActionsPanel({ actions }: { actions: IntelNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions intel-next-actions" aria-label="Next actions">
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

export function IntelShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: IntelShellKind;
  error?: string;
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const copy = intelShellCopy(shell);
  const setup = shell === "setup" ? intelSetupSteps(orgId)[0] : null;
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;

  return (
    <main className="module-page intel-page soft-gate">
      <PageHeader
        breadcrumbs="Competition / Research"
        title="Research"
        description={copy.description}
      >
        <IntelRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="intel-empty"
        badge={failure ? undefined : copy.badge}
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {shell === "error" && onRetry && (failure?.showRetry ?? true) ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}
