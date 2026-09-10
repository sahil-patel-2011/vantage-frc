"use client";

import { type ReactNode } from "react";
import { Button, CardGridSkeleton, EmptyState, ErrorState, PageHeader, StatRowSkeleton } from "../../components/ui";
import { CopyShareLink } from "../../components/copy-share-link";
import {
  EVENT_DAY_RELATED_INCLUDE,
  classifyEventDayShell,
  eventDayEmptyTitle,
  eventDayRelatedLinks,
  eventDayShellCopy,
  type EventDayShellKind,
  type EventDayShellNextAction,
} from "../../lib/command/event-day-related";
import { withOrgHref } from "../../lib/nav/product-nav";

export function EventDayRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = eventDayRelatedLinks(orgId, {
    include: [...EVENT_DAY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related edc-related" aria-label="Related live ops tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

export function EventDayNextActionsPanel({ actions }: { actions: EventDayShellNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="edc-next-actions soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Field-side steps from schedule and scout gaps.</p>
      </header>
      <ol>
        {actions.slice(0, 5).map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className={action.primary ? "app-button" : "app-button secondary"} href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function EventDayShell({
  orgId,
  shell,
  hasActiveEvent,
  error,
  onRetry,
  onSelectEvent,
  canSetEvent,
  embedded = false,
  children,
}: {
  orgId?: string | null;
  shell: EventDayShellKind;
  hasActiveEvent?: boolean;
  error?: string;
  onRetry?: () => void;
  onSelectEvent?: () => void;
  canSetEvent?: boolean;
  embedded?: boolean;
  children?: ReactNode;
}) {
  const copy = eventDayShellCopy(shell);
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const teamDataHref = withOrgHref("/team/data", orgId);
  const scheduleHref = withOrgHref("/schedule", orgId);

  const related = <EventDayRelatedStrip orgId={orgId} />;

  if (shell === "loading") {
    return (
      <main className={`edc-page${embedded ? " is-embedded" : ""} soft-gate`}>
        {embedded ? null : (
          <PageHeader breadcrumbs="Competition / Event Day" title="Command" description="Next match and pit cues.">
            {related}
          </PageHeader>
        )}
        {children}
        <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading Event Day Command">
          <StatRowSkeleton count={3} />
          <CardGridSkeleton cols={3} rows={1} />
        </div>
      </main>
    );
  }

  if (shell === "error") {
    return (
      <main className={`edc-page${embedded ? " is-embedded" : ""} soft-gate`}>
        {embedded ? null : (
          <PageHeader breadcrumbs="Competition / Event Day" title="Command" description="Next match and pit cues.">
            {related}
          </PageHeader>
        )}
        {children}
        <ErrorState title={copy.title} message={error ?? copy.description} onRetry={onRetry} />
      </main>
    );
  }

  const primarySetupCta =
    canSetEvent && onSelectEvent ? (
      <Button variant="primary" type="button" onClick={onSelectEvent}>
        Set active event
      </Button>
    ) : (
      <Button as="a" variant="primary" href={orgId ? teamDataHref : workspaceHref}>
        {orgId ? "Connect TBA" : "Choose your team"}
      </Button>
    );

  return (
    <main className={`edc-page${embedded ? " is-embedded" : ""} soft-gate`}>
      {embedded ? null : (
        <PageHeader
          breadcrumbs="Competition / Event Day"
          title="Command"
          description="Connect TBA and set an active event."
        >
          {related}
        </PageHeader>
      )}
      {children}
      <EmptyState
        soft
        className="edc-empty"
        badge={shell === "setup" ? "Setup required" : copy.badge}
        badgeTone="setup"
        title={eventDayEmptyTitle({ shell, orgId, hasActiveEvent })}
        description={
          error ?? (shell === "setup" ? "Connect TBA and set the active event." : copy.description)
        }
      >
        {shell === "setup" ? primarySetupCta : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={scheduleHref}>
            Check schedule sync
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export function CommandReadyHeader({
  embedded,
  orgId,
  title,
  orgName,
  teamNumber,
  eventKey,
  loading,
  computedAt,
  canSetEvent,
  onSelectEvent,
  onRefresh,
  headerActions,
}: {
  embedded: boolean;
  orgId: string | null;
  title: string;
  orgName: string | null;
  teamNumber: number | null;
  eventKey: string | null;
  loading: boolean;
  computedAt: string | null;
  canSetEvent: boolean;
  onSelectEvent: () => void;
  onRefresh: () => void;
  headerActions?: ReactNode;
}) {
  const actions = headerActions ?? (
    <div className="edc-header-actions">
      <span className="edc-live" aria-live="polite">
        {loading ? "Loading…" : `Updated ${computedAt ? new Date(computedAt).toLocaleTimeString() : "—"}`}
      </span>
      <CopyShareLink orgId={orgId} />
      {canSetEvent ? (
        <Button variant="secondary" type="button" onClick={onSelectEvent}>
          {eventKey ? "Change event" : "Select event"}
        </Button>
      ) : null}
      <Button variant="secondary" type="button" onClick={onRefresh} disabled={!orgId}>
        Refresh
      </Button>
    </div>
  );

  if (embedded) return actions;

  return (
    <PageHeader
      breadcrumbs="Competition / Event Day"
      title={title}
      description={
        <>
          {orgName ?? "Your team"}
          {teamNumber ? ` · Team ${teamNumber}` : ""}
          {eventKey ? ` · ${eventKey}` : ""}
          {" — "}
          Next match, scout gaps, and briefs.
        </>
      }
    >
      {actions}
    </PageHeader>
  );
}

export { classifyEventDayShell };
