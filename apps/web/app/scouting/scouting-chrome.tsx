"use client";

import type { ReactNode } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  SCOUTING_RELATED_INCLUDE,
  scoutingRelatedLinks,
  scoutingShellCopy,
  type ScoutingNextAction,
  type ScoutingShellKind,
} from "../../lib/scouting/scouting-related";

export function ScoutingRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = scoutingRelatedLinks(orgId, {
    include: [...SCOUTING_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related scout-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function ScoutingNextActionsPanel({ actions }: { actions: ScoutingNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions scout-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Forms, coverage, and strategy stay empty until you scout.</p>
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

export function ScoutingShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  embedded = false,
  children,
}: {
  orgId?: string | null;
  shell: ScoutingShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  embedded?: boolean;
  children?: ReactNode;
}) {
  const copy = scoutingShellCopy(shell);
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus ?? null,
            message: error ?? null,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error ?? null,
          },
        )
      : null;
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const commandHref = hubHref("/competition", "command", orgId);
  const formsHref = hubHref("/competition", "forms", orgId);

  return (
    <main className={`module-page scout-page soft-gate${embedded ? " is-embedded" : ""}`}>
      {embedded ? null : (
      <PageHeader
        breadcrumbs="Competition / Scouting"
        title="Scouting"
        description="Match and pit forms stay on this device until you sync."
      >
        <ScoutingRelatedStrip orgId={orgId} />
      </PageHeader>
      )}
      {children}
      <EmptyState
        soft
        className="scout-shell-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? copy.badge
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : (error ?? copy.description)}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? commandHref : workspaceHref}>{orgId ? "Set active event" : "Choose your team"}</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={formsHref}>Open Form builder</Button>
        ) : null}
      </EmptyState>
    </main>
  );
}
