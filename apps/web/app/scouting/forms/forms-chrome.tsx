"use client";

import { type ReactNode } from "react";
import { type EntryType } from "@vantage/scouting";
import { EmptyState, PageHeader, Button } from "../../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import {
  FORM_BUILDER_RELATED_INCLUDE,
  formBuilderNextActions,
  formBuilderRelatedLinks,
  formBuilderSetupSteps,
  formBuilderShellCopy,
  type FormBuilderNextAction,
  type FormBuilderShellKind,
} from "../../../lib/scouting/form-builder";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";

export function FormBuilderRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = formBuilderRelatedLinks(orgId, {
    include: [...FORM_BUILDER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related sfb-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function FormBuilderNextActionsPanel({ actions }: { actions: FormBuilderNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions sfb-next-actions"
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

export function FormBuilderShell({
  orgId,
  shell,
  entryType,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: FormBuilderShellKind;
  entryType?: EntryType;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = formBuilderNextActions({ orgId, shell, entryType });
  const copy = formBuilderShellCopy(shell, { entryType });
  const steps = shell === "setup" ? formBuilderSetupSteps(orgId) : [];
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
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  return (
    <main className="module-page sfb-page soft-gate">
      <PageHeader
        breadcrumbs="Competition / Form builder"
        title="Scouting form builder"
        description="Publish versioned match or pit schemas. Scouts and Coverage stay blank until a real version exists."
      >
        <FormBuilderRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="sfb-shell-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
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
          <Button as="a" variant="primary" href={scoutingHref}>Open Scouting</Button>
        ) : null}
        {shell === "setup" && steps.length > 0 ? (
          <ol className="sfb-setup-steps">
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
        ) : null}
      </EmptyState>
      {shell !== "loading" ? <FormBuilderNextActionsPanel actions={actions} /> : null}
    </main>
  );
}
