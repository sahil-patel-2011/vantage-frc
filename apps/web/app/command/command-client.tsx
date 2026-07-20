"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../components/app-shell";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { CardGridSkeleton, EmptyState, ErrorState, PageHeader, Panel, StatRowSkeleton } from "../../components/ui";
import { CopyShareLink } from "../../components/copy-share-link";
import { useVenueShortcuts, VenueShortcutCheatsheet } from "../../hooks/use-venue-shortcuts";
import { countdownLabel } from "../dashboard/widgets";
import { eventDayNextActions } from "../../lib/command/event-day-actions";
import {
  EVENT_DAY_RELATED_INCLUDE,
  classifyEventDayShell,
  eventDayRelatedLinks,
  eventDaySetupSteps,
  eventDayShellCopy,
  eventDayShellNextActions,
  formatEventDayMatchCount,
  type EventDayShellKind,
  type EventDayShellNextAction,
} from "../../lib/command/event-day-related";
import type { CommandSnapshot } from "../../lib/command/types";
import { formatMyDayWhen } from "../../lib/my-day";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./command.css";

type Me = {
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
};

type EventOption = {
  eventKey: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  city: string | null;
  stateProv: string | null;
  year: number;
};

const POLL_MS = 20_000;

function pct(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 100)}%`;
}

function teamLabel(teamKey: string, teamNumber?: number | null) {
  if (teamNumber) return String(teamNumber);
  const m = /^frc(\d+)$/i.exec(teamKey);
  return m ? m[1] : teamKey;
}

function AllianceChips({
  keys,
  ours,
  highlight,
}: {
  keys: string[];
  ours: string | null;
  highlight?: "red" | "blue";
}) {
  return (
    <ul className="edc-alliance">
      {keys.map((key) => (
        <li key={key} className={key === ours ? "us" : highlight ?? ""}>
          {teamLabel(key)}
        </li>
      ))}
    </ul>
  );
}

function EventDayRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = eventDayRelatedLinks(orgId, {
    include: [...EVENT_DAY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related edc-related" aria-label="Related live ops tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function EventDayNextActionsPanel({ actions }: { actions: EventDayShellNextAction[] }) {
  if (!actions.length) return null;
  return (
    <Panel className="edc-next-actions edc-shell-actions soft-panel">
      <header>
        <h2>Next actions</h2>
        <p>My Day, Schedule, Strategy, and Scouting — never DEMO schedule.</p>
      </header>
      <ol>
        {actions.map((action) => (
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
    </Panel>
  );
}

function EventDayShell({
  orgId,
  shell,
  hasActiveEvent,
  error,
  onRetry,
  onSelectEvent,
  canSetEvent,
  children,
}: {
  orgId?: string | null;
  shell: EventDayShellKind;
  hasActiveEvent?: boolean;
  error?: string;
  onRetry?: () => void;
  onSelectEvent?: () => void;
  canSetEvent?: boolean;
  children?: ReactNode;
}) {
  const actions = eventDayShellNextActions({
    orgId,
    shell,
    hasActiveEvent,
  });
  const copy = eventDayShellCopy(shell);
  const steps = shell === "setup" ? eventDaySetupSteps(orgId) : [];
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const teamDataHref = withOrgHref("/team/data", orgId);
  const myDayHref = hubHref("/competition", "my-day", orgId);
  const scheduleHref = withOrgHref("/schedule", orgId);
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);

  if (shell === "loading") {
    return (
      <main className="edc-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Event Day"
          title="Event Day Command"
          description="Next match, scout gaps, and labeled model briefs from real TBA rows — never DEMO schedule."
        >
          <EventDayRelatedStrip orgId={orgId} />
        </PageHeader>
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
      <main className="edc-page soft-gate">
        <PageHeader
          breadcrumbs="Competition / Event Day"
          title="Event Day Command"
          description="Next match, scout gaps, and labeled model briefs from real TBA rows — never DEMO schedule."
        >
          <EventDayRelatedStrip orgId={orgId} />
        </PageHeader>
        {children}
        <ErrorState
          title={copy.title}
          message={error ?? copy.description}
          onRetry={onRetry}
        />
        <EventDayNextActionsPanel actions={actions} />
      </main>
    );
  }

  return (
    <main className="edc-page soft-gate">
      <PageHeader
        breadcrumbs="Competition / Event Day"
        title="Event Day Command"
        description="Next match, scout gaps, and labeled model briefs from real TBA rows — never DEMO schedule."
      >
        <EventDayRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="edc-empty"
        badge={shell === "setup" ? "Setup required" : copy.badge}
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
      >
        {shell === "setup" ? (
          <>
            {canSetEvent && onSelectEvent ? (
              <button type="button" className="app-button" onClick={onSelectEvent}>
                Select event
              </button>
            ) : (
              <a className="app-button" href={orgId ? teamDataHref : workspaceHref}>
                {orgId ? "Sync Team Data" : "Select workspace"}
              </a>
            )}
            <a className="app-button secondary" href={myDayHref}>
              Open My Day
            </a>
            <a className="app-button secondary" href={scheduleHref}>
              Open Schedule
            </a>
          </>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={scheduleHref}>
              Open Schedule
            </a>
            <a className="app-button secondary" href={myDayHref}>
              Open My Day
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
          </>
        ) : null}
        {shell === "setup" && steps.length > 0 ? (
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
        ) : null}
      </EmptyState>
      <EventDayNextActionsPanel actions={actions} />
    </main>
  );
}

export default function CommandClient() {
  const [me, setMe] = useState<Me>({});
  const [orgId, setOrgId] = useState("");
  const [snap, setSnap] = useState<CommandSnapshot | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventQ, setEventQ] = useState("");
  const [events, setEvents] = useState<EventOption[]>([]);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventMessage, setEventMessage] = useState("");
  const [tick, setTick] = useState(0);
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(orgId);

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("orgId") ?? "";
    void fetch("/api/me")
      .then(async (r) => (r.ok ? ((await r.json()) as Me) : null))
      .then((data) => {
        if (!data) return;
        setMe(data);
        setOrgId(fromUrl || data.orgId || "");
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setLoading(false);
      setSnap(null);
      setFetchFailed(false);
      return;
    }
    try {
      const response = await fetch(`/api/command?orgId=${encodeURIComponent(id)}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not load Event Day Command");
        setFetchFailed(true);
        setLoading(false);
        return;
      }
      const data = (await response.json()) as CommandSnapshot;
      setSnap(data);
      setError("");
      setFetchFailed(false);
      setLoading(false);
    } catch {
      setError("Could not load Event Day Command");
      setFetchFailed(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    void load(orgId);
    const poll = window.setInterval(() => void load(orgId), POLL_MS);
    return () => window.clearInterval(poll);
  }, [orgId, load]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadEvents = useCallback(
    async (q: string) => {
      if (!orgId) return;
      const year = new Date().getFullYear();
      const params = new URLSearchParams({ orgId, year: String(year), q });
      const response = await fetch(`/api/context/event?${params}`);
      if (!response.ok) return;
      const data = await response.json();
      setEvents(data.events ?? []);
    },
    [orgId],
  );

  useEffect(() => {
    if (!eventOpen) return;
    const handle = window.setTimeout(() => void loadEvents(eventQ), 200);
    return () => window.clearTimeout(handle);
  }, [eventOpen, eventQ, loadEvents]);

  async function setActiveEvent(eventKey: string | null) {
    if (!orgId) return;
    setEventBusy(true);
    setEventMessage("");
    try {
      const response = await fetch("/api/context/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, eventKey }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setEventMessage(body.error ?? "Could not set event");
        return;
      }
      setEventOpen(false);
      setEventMessage(eventKey ? `Active event set to ${body.eventName ?? eventKey}` : "Active event cleared");
      await load(orgId);
    } finally {
      setEventBusy(false);
    }
  }

  const next = snap?.matches[0] ?? null;
  const after = snap?.matches[1] ?? null;
  const countdown = useMemo(() => countdownLabel(next?.scheduledTime), [next?.scheduledTime, tick]);
  const liveActions = useMemo(() => eventDayNextActions(snap, { orgId: orgId || null }), [snap, orgId]);
  const myDayHref = snap?.links.myDay ?? hubHref("/competition", "my-day", orgId || null);
  const scheduleHref = snap?.links.schedule ?? withOrgHref("/schedule", orgId || null);
  const strategyHref = snap?.links.strategy ?? hubHref("/competition", "strategy", orgId || null);
  const scoutingHref = snap?.links.scouting ?? hubHref("/competition", "scouting", orgId || null);
  const teamDataHref = snap?.links.teamData ?? withOrgHref("/team/data", orgId || null);
  const matchChecklistHref =
    snap?.links.matchChecklist ?? hubHref("/competition", "match-checklist", orgId || null);
  const logisticsHref = snap?.links.logistics ?? withOrgHref("/logistics", orgId || null);
  const pitHref = snap?.links.pit ?? withOrgHref("/pit", orgId || null);
  const batteriesHref = snap?.links.batteries ?? withOrgHref("/batteries", orgId || null);
  const intelHref = snap?.links.intel ?? withOrgHref("/intel", orgId || null);
  const chemistryHref = snap?.links.chemistry ?? hubHref("/competition", "chemistry", orgId || null);

  const eventPicker = eventOpen ? (
    <div className="edc-modal" role="dialog" aria-modal="true" aria-labelledby="edc-event-title">
      <div>
        <header>
          <h2 id="edc-event-title">Select active event</h2>
          <button type="button" aria-label="Close" onClick={() => setEventOpen(false)}>
            ×
          </button>
        </header>
        <p className="edc-muted">
          Only owners and admins can set the event. Lists come from the TBA reference cache — empty means sync
          first. Never DEMO events.
        </p>
        <input
          className="edc-search"
          value={eventQ}
          onChange={(e) => setEventQ(e.target.value)}
          placeholder="Search event name, key, or city"
          aria-label="Search events"
        />
        <ul className="edc-event-list">
          {events.length ? (
            events.map((event) => (
              <li key={event.eventKey}>
                <button type="button" disabled={eventBusy} onClick={() => void setActiveEvent(event.eventKey)}>
                  <strong>{event.name}</strong>
                  <span>
                    {event.eventKey}
                    {event.city ? ` · ${event.city}` : ""}
                    {event.stateProv ? `, ${event.stateProv}` : ""}
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="edc-empty-events">
              No events in cache for this year.{" "}
              <a href={teamDataHref}>Open Team → Data to sync TBA</a>
            </li>
          )}
        </ul>
        {snap?.eventKey ? (
          <button
            className="app-button secondary"
            type="button"
            disabled={eventBusy}
            onClick={() => void setActiveEvent(null)}
          >
            Clear active event
          </button>
        ) : null}
      </div>
    </div>
  ) : null;

  if (loading && !snap && orgId) {
    return <EventDayShell orgId={orgId || null} shell={classifyEventDayShell({ loading: true })} />;
  }

  if (!orgId && !loading) {
    return (
      <>
        <EventDayShell orgId={null} shell="setup" hasActiveEvent={false} />
        {eventPicker}
      </>
    );
  }

  if ((fetchFailed || error) && !snap) {
    return (
      <>
        <EventDayShell
          orgId={orgId || null}
          shell="error"
          error={error || undefined}
          onRetry={() => {
            setLoading(true);
            setFetchFailed(false);
            void load(orgId);
          }}
        />
        {eventPicker}
      </>
    );
  }

  const shell = classifyEventDayShell({
    orgId: orgId || null,
    status: snap?.status ?? null,
    eventKey: snap?.eventKey ?? null,
    matchCount: snap?.matches.length ?? 0,
  });

  if (shell === "setup") {
    return (
      <>
        <EventDayShell
          orgId={orgId || null}
          shell="setup"
          hasActiveEvent={Boolean(snap?.eventKey)}
          error={snap?.status === "setup_required" ? snap.message : undefined}
          canSetEvent={snap?.canSetEvent}
          onSelectEvent={snap?.canSetEvent ? () => setEventOpen(true) : undefined}
        />
        {eventPicker}
      </>
    );
  }

  if (shell === "empty") {
    return (
      <>
        <EventDayShell orgId={orgId || null} shell="empty" hasActiveEvent={Boolean(snap?.eventKey)}>
          <p className="edc-freshness" role="status">
            {snap?.eventName ?? snap?.eventKey ?? "Active event"}
            {" · "}
            {formatEventDayMatchCount(snap?.matches.length ?? 0, Boolean(snap))} upcoming matches
            {" — never DEMO schedule"}
          </p>
          <DataSourceDegradedBanner health={snap?.dataSourceHealth} />
        </EventDayShell>
        {eventPicker}
      </>
    );
  }

  return (
    <main className="edc-page">
      <PageHeader
        breadcrumbs="Competition / Event Day"
        title={snap?.eventName ?? "Event Day Command"}
        description={
          <>
            {snap?.orgName ? `${snap.orgName}` : me.orgName ?? "Your team"}
            {snap?.teamNumber ? ` · Team ${snap.teamNumber}` : ""}
            {snap?.eventKey ? ` · ${snap.eventKey}` : ""}
            {" — "}
            Next match, scout gaps, and labeled model briefs. Never DEMO schedule.
          </>
        }
      >
        <div className="edc-header-actions">
          <span className="edc-live" aria-live="polite">
            {loading && !snap ? "Loading…" : `Updated ${snap ? new Date(snap.computedAt).toLocaleTimeString() : "—"}`}
          </span>
          <CopyShareLink orgId={orgId || null} />
          {snap?.canSetEvent ? (
            <button className="app-button secondary" type="button" onClick={() => setEventOpen(true)}>
              {snap.eventKey ? "Change event" : "Select event"}
            </button>
          ) : null}
          <button className="app-button secondary" type="button" onClick={() => void load(orgId)} disabled={!orgId}>
            Refresh
          </button>
        </div>
      </PageHeader>
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      <EventDayRelatedStrip orgId={orgId || null} />

      {error ? <p className="edc-banner error">{error}</p> : null}
      {eventMessage ? <p className="edc-banner ok">{eventMessage}</p> : null}
      <DataSourceDegradedBanner health={snap?.dataSourceHealth} />

      {liveActions.length ? (
        <section className="edc-next-actions soft-panel" aria-label="Next actions">
          <header>
            <h2>Next actions</h2>
            <p>Clear field-side steps from real schedule, scout gaps, and setup — never invents DEMO metrics.</p>
          </header>
          <ol>
            {liveActions.slice(0, 5).map((action) => (
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
      ) : null}

      <section className="edc-priority" aria-label="Priority panels">
        <article className={`edc-card edc-next ${next ? "live" : "empty"}`}>
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="swords" />
              </span>
              <div>
                <h2>Now / Next</h2>
                <p>{next ? "Your upcoming match from TBA cache" : "Waiting for schedule"}</p>
              </div>
            </div>
            {next ? <span className="edc-pill">{countdown}</span> : null}
          </header>
          {next ? (
            <>
              <div className={`edc-match-hero alliance-${next.ourAlliance ?? "tbd"}`}>
                <strong>
                  {next.compLevel.toUpperCase()} {next.matchNumber}
                </strong>
                <span className="edc-match-when">{formatMyDayWhen(next.scheduledTime) ?? "Time TBD"}</span>
                <span className={`edc-bumper-cue ${next.ourAlliance ?? ""}`}>
                  {snap?.myDay?.bumperCue ??
                    (next.ourAlliance
                      ? `Switch to ${next.ourAlliance.toUpperCase()} bumpers`
                      : "Alliance TBD — confirm bumpers")}
                </span>
              </div>
              <p className="edc-partners">
                <span>With</span>{" "}
                <b>
                  {(next.ourAlliance === "red"
                    ? next.red.teamKeys
                    : next.ourAlliance === "blue"
                      ? next.blue.teamKeys
                      : []
                  )
                    .filter((key) => key !== snap?.teamKey)
                    .map((key) => teamLabel(key))
                    .join(" · ") || "—"}
                </b>
                <span className="edc-vs"> vs </span>
                <b>
                  {(next.ourAlliance === "red"
                    ? next.blue.teamKeys
                    : next.ourAlliance === "blue"
                      ? next.red.teamKeys
                      : []
                  )
                    .map((key) => teamLabel(key))
                    .join(" · ") || "—"}
                </b>
              </p>
              <div className="edc-alliances">
                <div>
                  <span>Red</span>
                  <AllianceChips keys={next.red.teamKeys} ours={snap?.teamKey ?? null} highlight="red" />
                </div>
                <div>
                  <span>Blue</span>
                  <AllianceChips keys={next.blue.teamKeys} ours={snap?.teamKey ?? null} highlight="blue" />
                </div>
              </div>
              {snap?.myDay ? (
                <ul className="edc-myday-strip" aria-label="Hotels and travel">
                  <li>
                    <span>Travel</span>
                    <b>
                      {snap.myDay.nextTravelLabel ??
                        "No leave time published — open Logistics (never DEMO departures)"}
                    </b>
                  </li>
                  <li>
                    <span>Room</span>
                    <b>
                      {snap.myDay.lodgingLabel ??
                        "No lodging assigned — mentors publish hotels on Logistics"}
                    </b>
                  </li>
                  {snap.myDay.onDutyLabel ? (
                    <li>
                      <span>On duty</span>
                      <b>{snap.myDay.onDutyLabel}</b>
                    </li>
                  ) : (
                    <li>
                      <span>On duty</span>
                      <b>No on-duty mentor posted yet</b>
                    </li>
                  )}
                </ul>
              ) : null}
              <footer className="edc-after edc-myday-links">
                <a href={myDayHref}>My Day</a>
                <a href={scheduleHref}>Schedule</a>
                <a href={matchChecklistHref}>Checklist</a>
                <a href={logisticsHref}>Logistics</a>
                {after ? (
                  <span>
                    After · {after.compLevel.toUpperCase()} {after.matchNumber}
                    {after.scheduledTime ? ` · ${countdownLabel(after.scheduledTime)}` : ""}
                  </span>
                ) : null}
              </footer>
            </>
          ) : (
            <div className="dash-empty">
              <strong>No upcoming match</strong>
              <p>{snap?.message ?? "Sync TBA and select your event to load the queue — never DEMO times."}</p>
              {snap?.myDay ? (
                <ul className="edc-myday-strip" aria-label="Hotels and travel">
                  <li>
                    <span>Travel</span>
                    <b>{snap.myDay.nextTravelLabel ?? "No leave time published yet"}</b>
                  </li>
                  <li>
                    <span>Room</span>
                    <b>{snap.myDay.lodgingLabel ?? "No lodging assigned yet"}</b>
                  </li>
                </ul>
              ) : null}
              <a className="dash-empty-cta" href={scheduleHref}>
                Open Schedule
              </a>
              <a className="dash-empty-cta" href={logisticsHref}>
                Open Logistics
              </a>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#15803d", ["--tone-bg" as string]: "#dcfce7" }}>
                <Icon name="clipboard" />
              </span>
              <div>
                <h2>Scout next</h2>
                <p>
                  {snap
                    ? `${snap.coverage.upcomingUnscouted} gap${snap.coverage.upcomingUnscouted === 1 ? "" : "s"} in upcoming alliances`
                    : "Coverage queue"}
                </p>
              </div>
            </div>
          </header>
          {snap?.scoutQueue.length ? (
            <ul className="edc-queue">
              {snap.scoutQueue.map((item) => (
                <li key={`${item.teamKey}-${item.matchKey}`}>
                  <div>
                    <strong>{item.teamNumber ?? teamLabel(item.teamKey)}</strong>
                    <span>
                      {item.matchLabel ?? "Event"} · {item.reasons.slice(0, 2).join(" · ")}
                    </span>
                  </div>
                  <a href={item.formHref}>Scout</a>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>Queue clear</strong>
              <p>
                {snap?.eventKey
                  ? "Upcoming alliance partners and opponents already have coverage, or no matches are queued."
                  : "Select an event to build the scout queue from schedule gaps."}
              </p>
              <a className="dash-empty-cta" href={scoutingHref}>
                Open Scouting
              </a>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="bolt" />
              </span>
              <div>
                <h2>Matchup snapshot</h2>
                <p>
                  {snap?.prediction.modelVersion
                    ? `MODEL ${snap.prediction.modelVersion}`
                    : "Labeled win/loss when schedule + metrics exist"}
                </p>
              </div>
            </div>
          </header>
          {snap?.prediction.status === "live" && snap.prediction.pOur != null ? (
            <>
              <div className="edc-prob">
                <strong>{pct(snap.prediction.pOur)}</strong>
                <span>Our win probability</span>
              </div>
              <p className="edc-muted">
                Opp {pct(snap.prediction.pOpp)}
                {snap.prediction.confidenceLow != null && snap.prediction.confidenceHigh != null
                  ? ` · band ${pct(snap.prediction.confidenceLow)}–${pct(snap.prediction.confidenceHigh)}`
                  : ""}
              </p>
              <ul className="edc-factors">
                {snap.prediction.keyFactors.slice(0, 3).map((factor) => (
                  <li key={factor.name}>
                    <strong>{factor.name}</strong>
                    <span>{factor.evidence}</span>
                  </li>
                ))}
              </ul>
              {snap.prediction.caveats[0] ? <p className="edc-caveat">{snap.prediction.caveats[0]}</p> : null}
              <a className="edc-link" href={strategyHref}>
                Open full strategy →
              </a>
            </>
          ) : (
            <div className="dash-empty calm">
              <strong>No prediction yet</strong>
              <p>Needs an upcoming match plus TBA/Statbotics metrics. Never shown as a TBA fact or DEMO win rate.</p>
              <a className="dash-empty-cta" href={strategyHref}>
                Open Strategy
              </a>
            </div>
          )}
        </article>
      </section>

      <section className="edc-coverage-section" aria-label="Live scout coverage">
        <article className={`edc-card edc-coverage ${snap?.coverage.missingRows ? "gap" : ""}`}>
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#b45309", ["--tone-bg" as string]: "#ffedd5" }}>
                <Icon name="users" />
              </span>
              <div>
                <h2>Live coverage</h2>
                <p>
                  {snap?.coverage.liveBoard?.length
                    ? `${snap.coverage.missingRows} uncovered · ${snap.coverage.doubleCovered} double-scouted on now/next`
                    : "Double-scouted vs unscouted rows for now/next matches"}
                </p>
              </div>
            </div>
            {snap?.coverage.coordinatorNudge?.status === "sent" ? (
              <span className="edc-pill warn">Coordinator nudged</span>
            ) : snap?.coverage.coordinatorNudge?.status === "throttled" ? (
              <span className="edc-pill">Nudge cooling down</span>
            ) : null}
          </header>
          {snap?.coverage.liveBoard?.length ? (
            <>
              <div className="edc-coverage-board" role="list">
                {snap.coverage.liveBoard.slice(0, 24).map((cell) => (
                  <article key={`${cell.matchKey}-${cell.teamKey}`} className={cell.state} role="listitem">
                    <b>
                      {cell.compLevel.toUpperCase()} {cell.matchNumber}
                    </b>
                    <span>{cell.teamNumber ?? teamLabel(cell.teamKey)}</span>
                    <small>
                      {cell.state.replaceAll("_", " ")}
                      {cell.entryCount > 1 ? ` · ${cell.entryCount}` : ""}
                    </small>
                  </article>
                ))}
              </div>
              {snap.coverage.coordinatorNudge?.message ? (
                <p className="edc-muted">{snap.coverage.coordinatorNudge.message}</p>
              ) : null}
              <a className="edc-link" href={scoutingHref}>
                Open Scouting →
              </a>
            </>
          ) : (
            <div className="dash-empty calm">
              <strong>No live match rows yet</strong>
              <p>
                When TBA puts your next matches on the board, uncovered vs double-scouted robots appear here — never
                DEMO coverage zeros.
              </p>
              <a className="dash-empty-cta" href={scoutingHref}>
                Open Scouting
              </a>
            </div>
          )}
        </article>
      </section>

      <section className="edc-secondary" aria-label="Briefs and flags">
        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#0f766e", ["--tone-bg" as string]: "#ccfbf1" }}>
                <Icon name="target" />
              </span>
              <div>
                <h2>Drive coach briefs</h2>
                <p>Opponent tendencies + scout capabilities (cited)</p>
              </div>
            </div>
          </header>
          {snap?.briefs.length ? (
            <ul className="edc-briefs">
              {snap.briefs.map((brief) => (
                <li key={brief.teamKey}>
                  <div className="edc-brief-head">
                    <strong>{brief.teamNumber ?? teamLabel(brief.teamKey)}</strong>
                    <div className="edc-tags">
                      {brief.labels.map((label) => (
                        <span key={label}>{label}</span>
                      ))}
                    </div>
                  </div>
                  {brief.capabilities.length ? (
                    <p className="edc-caps">{brief.capabilities.join(" · ")}</p>
                  ) : null}
                  <ul>
                    {brief.evidence.slice(0, 3).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>No opponent briefs</strong>
              <p>Briefs appear once your next match is known and reference metrics or scout notes exist.</p>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#b91c1c", ["--tone-bg" as string]: "#fee2e2" }}>
                <Icon name="bell" />
              </span>
              <div>
                <h2>Pit flags · this match</h2>
                <p>Mechanical / reliability signals that matter now</p>
              </div>
            </div>
          </header>
          {snap?.pitFlags.length ? (
            <ul className="edc-flags">
              {snap.pitFlags.map((flag) => (
                <li key={`${flag.teamKey}-${flag.title}`} data-severity={flag.severity}>
                  <strong>
                    {flag.teamNumber ?? teamLabel(flag.teamKey)} · {flag.title}
                  </strong>
                  <span>{flag.detail}</span>
                  <small>{flag.evidence}</small>
                </li>
              ))}
            </ul>
          ) : (
            <div className="dash-empty calm">
              <strong>No pit flags</strong>
              <p>Pit and match scout reliability notes for the next alliance appear here when logged.</p>
            </div>
          )}
        </article>

        <article className="edc-card">
          <header>
            <div className="edc-card-title">
              <span className="edc-icon" style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}>
                <Icon name="stats" />
              </span>
              <div>
                <h2>Season pulse</h2>
                <p>Record & rank with source label</p>
              </div>
            </div>
          </header>
          {snap?.record.status === "live" ? (
            <div className="edc-pulse">
              <div>
                <strong>
                  {snap.record.wins ?? 0}-{snap.record.losses ?? 0}-{snap.record.ties ?? 0}
                </strong>
                <span>W-L-T</span>
              </div>
              <div>
                <strong>{snap.record.rank ?? "—"}</strong>
                <span>Rank</span>
              </div>
              <div>
                <strong>{snap.record.epaTotal != null ? Math.round(snap.record.epaTotal * 10) / 10 : "—"}</strong>
                <span>EPA</span>
              </div>
              <p className="edc-muted">
                Source: {snap.record.source ?? "reference"}
                {snap.record.syncedAt ? ` · synced ${new Date(snap.record.syncedAt).toLocaleString()}` : ""}
              </p>
              <p className="edc-muted">
                Scout coverage: {snap.coverage.matchReports} match · {snap.coverage.pitReports} pit
                {snap.coverage.openDisagreements ? ` · ${snap.coverage.openDisagreements} open disagreements` : ""}
              </p>
            </div>
          ) : (
            <div className="dash-empty calm">
              <strong>No event metrics yet</strong>
              <p>Rank and EPA appear after TBA/Statbotics sync for your team at this event — never DEMO stats.</p>
            </div>
          )}
        </article>
      </section>

      <nav className="edc-actions" aria-label="Primary competition links">
        <a href={myDayHref}>
          <Icon name="calendar" />
          <strong>My Day</strong>
          <span>Personal next match</span>
        </a>
        <a href={scheduleHref}>
          <Icon name="calendar" />
          <strong>Schedule</strong>
          <span>Full event board</span>
        </a>
        <a href={strategyHref}>
          <Icon name="bolt" />
          <strong>Strategy</strong>
          <span>Playbook & prediction</span>
        </a>
        <a href={scoutingHref}>
          <Icon name="clipboard" />
          <strong>Scouting</strong>
          <span>Match & pit forms</span>
        </a>
        <a href={pitHref}>
          <Icon name="cube" />
          <strong>Pit</strong>
          <span>Release gate & batteries</span>
        </a>
        <a href={batteriesHref}>
          <Icon name="bolt" />
          <strong>Batteries</strong>
          <span>Fleet readiness</span>
        </a>
        <a href={logisticsHref}>
          <Icon name="pin" />
          <strong>Logistics</strong>
          <span>Hotel & travel</span>
        </a>
        <a href={intelHref}>
          <Icon name="stats" />
          <strong>Intel</strong>
          <span>Team lookup</span>
        </a>
        <a href={chemistryHref}>
          <Icon name="users" />
          <strong>Chemistry</strong>
          <span>Alliance fit</span>
        </a>
      </nav>

      {eventPicker}
    </main>
  );
}
