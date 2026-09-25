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
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { scoutEventLabel } from "../../lib/scouting/scouting-related";

export function EventDayRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = eventDayRelatedLinks(orgId, {
    include: [...EVENT_DAY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related edc-related" aria-label="Related live ops tools">
      {links.map((link) => (
        <a key={link.href} href={link.href}>{link.label}</a>
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
            <Button as="a" variant={action.primary ? "primary" : "secondary"} href={action.href}>
              Open
            </Button>
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
  const scheduleHref = withOrgHref("/schedule", orgId);
  const notOnSchedule = /isn't on this event's match schedule/.test(error ?? "");

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
        <div style={{ display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading Event day">
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

  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const primarySetupCta =
    canSetEvent && onSelectEvent ? (
      <Button variant="primary" type="button" onClick={onSelectEvent}>
        Set active event
      </Button>
    ) : (
      <Button as="a" variant="primary" href={orgId ? scoutingHref : workspaceHref}>
        {orgId ? "Back to Scouting" : "Choose your team"}
      </Button>
    );

  return (
    <main className={`edc-page${embedded ? " is-embedded" : ""} soft-gate`}>
      {embedded ? null : (
        <PageHeader
          breadcrumbs="Competition / Event Day"
          title="Command"
          description="Set the event you’re at so match times can show."
        >
          {related}
        </PageHeader>
      )}
      {children}
      <EmptyState
        soft
        className="edc-empty"
        badge={shell === "setup" ? "Needs setup" : copy.badge}
        badgeTone="setup"
        title={
          shell === "empty" && notOnSchedule ? "Not on this event's schedule" : eventDayEmptyTitle({ shell, orgId, hasActiveEvent })
        }
        description={error ?? copy.description}
      >
        {shell === "setup" ? primarySetupCta : null}
        {shell === "empty" && notOnSchedule && canSetEvent && onSelectEvent ? (
          <Button variant="primary" type="button" onClick={onSelectEvent}>
            Change event
          </Button>
        ) : shell === "empty" && !notOnSchedule ? (
          <Button as="a" variant="secondary" href={scheduleHref}>
            See the full schedule
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
  eventName,
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
  eventName?: string | null;
  loading: boolean;
  computedAt: string | null;
  canSetEvent: boolean;
  onSelectEvent: () => void;
  onRefresh: () => void;
  headerActions?: ReactNode;
}) {
  const eventLabel = scoutEventLabel({ eventName, eventKey });
  const actions = headerActions ?? (
    <div className="edc-header-actions">
      {/* The board refreshes itself, so "Refresh" is the timestamp rather than a third
          button beside it: it says how fresh the data is and, pressed, makes it fresher. */}
      <button
        type="button"
        className="edc-live"
        aria-live="polite"
        onClick={onRefresh}
        disabled={!orgId || loading}
        title="Updates on its own. Press to refresh now."
      >
        {loading ? "Loading…" : `Updated ${computedAt ? new Date(computedAt).toLocaleTimeString() : "—"} · Refresh`}
      </button>
      <CopyShareLink orgId={orgId} variant="ghost" />
      {canSetEvent ? (
        <Button variant="secondary" type="button" onClick={onSelectEvent}>
          {eventKey ? "Change event" : "Set active event"}
        </Button>
      ) : null}
    </div>
  );

  if (embedded) {
    return (
      <>
        <EventDayRelatedStrip orgId={orgId} />
        {actions}
      </>
    );
  }

  return (
    <PageHeader
      breadcrumbs="Competition / Event Day"
      title={title}
      description={
        <>
          {orgName ?? "Your team"}
          {teamNumber ? ` · Team ${teamNumber}` : ""}
          {eventLabel ? ` · ${eventLabel}` : ""}
          {" — "}
          Next match, scout gaps, and briefs.
        </>
      }
    >
      <EventDayRelatedStrip orgId={orgId} />
      {actions}
    </PageHeader>
  );
}

export { classifyEventDayShell };
