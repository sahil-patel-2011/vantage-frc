"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import type {
  PresenceUnlinkedHourLog,
  PresenceUnmatchedName,
  PresenceView,
} from "../../lib/presence/compute-presence";
import { formatMinutes } from "../../lib/presence/summary";
import {
  PRESENCE_DISCREPANCY_DETAILS,
  PRESENCE_DISCREPANCY_LABELS,
  PRESENCE_RSVP_LABELS,
  type PresenceFigure,
  type PresenceMemberRow,
} from "../../lib/presence/types";
import { comingTonightLabel, isComingTonight } from "../../lib/presence/unify";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./presence.css";

type LiveView = Extract<PresenceView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const PAGE_TITLE = "Presence";
const PAGE_DESCRIPTION =
  "One number for who is coming tonight: RSVP, roll call, and clocked hours, counted once. Nobody is invented from silence.";

function todayIso(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function displayName(row: { name: string | null; userId: string }): string {
  return row.name?.trim() || "Unnamed member";
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

/** A figure renders its NAMED REASON when it has no honest value — never 0%. */
function Figure({ figure }: { figure: PresenceFigure }) {
  if (figure.value == null) {
    return (
      <div className="prs-figure unavailable">
        <strong>Not available</strong>
        <p className="app-muted prs-tip">{figure.reason}</p>
      </div>
    );
  }
  return (
    <div className="prs-figure">
      <strong>{figure.value}%</strong>
      <p className="app-muted prs-tip">{figure.label}</p>
    </div>
  );
}

function Shell({
  orgId,
  children,
  headerExtra,
}: {
  orgId: string | null;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <main className="module-page prs-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={hubHref("/team", "attendance", orgId)}>Team</a>
            {" / Presence"}
          </>
        }
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
      >
        {headerExtra}
      </PageHeader>
      {children}
    </main>
  );
}

export default function PresenceClient() {
  const [view, setView] = useState<PresenceView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState<string>(todayIso());
  const [eventId, setEventId] = useState<string | null>(null);

  const load = useCallback(
    (overrides?: { date?: string; eventId?: string | null }) => {
      setFetchFailed(false);
      setError("");
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      const nextDate = overrides?.date ?? date;
      if (nextDate) query.set("date", nextDate);
      const nextEvent = overrides && "eventId" in overrides ? overrides.eventId : eventId;
      if (nextEvent) query.set("eventId", nextEvent);
      void fetch(`/api/presence?${query.toString()}`)
        .then(async (response) => {
          const data = (await response.json()) as PresenceView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setFetchFailed(true);
            return;
          }
          setView(data);
          if (data.status === "live") setEventId(data.selected?.eventId ?? null);
        })
        .catch(() => setFetchFailed(true));
    },
    [date, eventId],
  );

  useEffect(() => {
    load();
     
  }, []);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setNotice("");
      void fetch("/api/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, date, eventId: eventId ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as PresenceView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          if (data.status === "live") setEventId(data.selected?.eventId ?? null);
          setNotice("Saved.");
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy, date, eventId],
  );

  const onPickDate = (next: string) => {
    setDate(next);
    setEventId(null);
    load({ date: next, eventId: null });
  };

  const onPickEvent = (next: string) => {
    setEventId(next);
    load({ eventId: next });
  };

  if (view == null && !fetchFailed) {
    return (
      <Shell orgId={null}>
        <div aria-busy="true" aria-label="Loading presence">
          <SoftBlockSkeleton lines={4} />
        </div>
      </Shell>
    );
  }

  if (fetchFailed || view == null) {
    return (
      <Shell orgId={orgId}>
        <ErrorState message="Could not load presence." onRetry={() => load()} />
      </Shell>
    );
  }

  if (view.status === "setup_required") {
    return (
      <Shell orgId={orgId}>
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="Nothing to reconcile yet"
          description={view.message}
        />
        {view.steps.length > 0 ? (
          <Panel className="prs-panel" aria-label="Setup steps">
            <h2 className="prs-panel-title">Setup steps</h2>
            <ul className="prs-steps">
              {view.steps.map((step) => (
                <li key={step.id}>
                  <div>
                    <strong>{step.label}</strong>
                    <p className="app-muted prs-tip">{step.detail}</p>
                  </div>
                  <Button as="a" variant="secondary" href={withOrgHref(step.href, orgId)}>
                    Open
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}
      </Shell>
    );
  }

  return (
    <Live
      view={view}
      busy={busy}
      error={error}
      notice={notice}
      date={date}
      mutate={mutate}
      onPickDate={onPickDate}
      onPickEvent={onPickEvent}
    />
  );
}

function Live({
  view,
  busy,
  error,
  notice,
  date,
  mutate,
  onPickDate,
  onPickEvent,
}: {
  view: LiveView;
  busy: boolean;
  error: string;
  notice: string;
  date: string;
  mutate: Mutate;
  onPickDate: (date: string) => void;
  onPickEvent: (eventId: string) => void;
}) {
  const { selected, summary, rows, unification } = view;

  const coming = useMemo(() => rows.filter((row) => isComingTonight(row)), [rows]);
  const here = useMemo(
    () => rows.filter((row) => row.attended === true || (row.minutes != null && row.minutes > 0)),
    [rows],
  );
  const tonightLabel = comingTonightLabel(unification);

  // The one primary action: commit what this screen currently shows as the
  // reconciled record for the meeting. Nothing is written until a human presses it.
  const saveAll = () => {
    if (!selected || rows.length === 0) return;
    mutate({
      action: "record-presence",
      records: rows.map((row) => ({
        targetUserId: row.userId,
        rsvp: row.rsvp,
        attended: row.attended,
        minutes: row.minutes,
        hourLogId: row.hourLogIds[0] ?? null,
        source: row.attended != null ? "roll_call" : row.minutes != null ? "kiosk" : "rsvp",
      })),
    });
  };

  return (
    <main className="module-page prs-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={hubHref("/team", "attendance", view.orgId)}>Team</a>
            {" / Presence"}
          </>
        }
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
      >
        <div className="prs-picker">
          <label className="app-muted prs-field">
            Date
            <input type="date" value={date} onChange={(event) => onPickDate(event.target.value)} />
          </label>
          {view.occurrences.length > 0 ? (
            <label className="app-muted prs-field">
              Meeting
              <select
                value={selected?.eventId ?? ""}
                onChange={(event) => onPickEvent(event.target.value)}
              >
                {view.occurrences.map((option) => (
                  <option key={`${option.eventId}-${option.startsAt}`} value={option.eventId}>
                    {option.title}
                    {option.subteamName ? ` · ${option.subteamName}` : ""}
                    {` · ${formatTime(option.startsAt)}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice && !error ? (
        <p className="app-muted prs-tip" role="status">
          {notice}
        </p>
      ) : null}

      {!selected ? (
        <EmptyState
          soft
          badge="No meeting"
          badgeTone="setup"
          title={`Nothing on the calendar for ${formatDay(view.presenceDate)}`}
          description="Presence hangs off a calendar occurrence, so there is nothing to reconcile on a day with no meeting. Pick another date, or add the meeting to the team calendar first."
        >
          <Button as="a" variant="secondary" className="prs-empty-action" href={withOrgHref("/team/calendar", view.orgId)}>
            Open the calendar
          </Button>
        </EmptyState>
      ) : (
        <>
          <Panel className="prs-panel prs-hero" aria-label="Selected meeting">
            <div className="prs-hero-main">
              <h2 className="prs-panel-title">{selected.title}</h2>
              <p className="app-muted prs-tip">
                {formatDay(view.presenceDate)}
                {formatTime(selected.startsAt) ? ` · ${formatTime(selected.startsAt)}` : ""}
                {selected.endsAt ? `–${formatTime(selected.endsAt)}` : ""}
                {selected.location ? ` · ${selected.location}` : ""}
                {selected.recurring ? " · part of a repeating series" : ""}
              </p>
              {view.recordedCount > 0 ? (
                <Badge tone="good">{view.recordedCount} presence records saved</Badge>
              ) : (
                <Badge tone="info">Nothing recorded for this meeting yet</Badge>
              )}
              <div className="prs-coming-hero" aria-label="Coming tonight">
                <strong>{view.comingTonight}</strong>
                <span>coming tonight</span>
                <p className="app-muted prs-tip">{tonightLabel}</p>
              </div>
            </div>
            <div className="prs-hero-action">
              <Button
                variant="primary"
                disabled={busy || rows.length === 0}
                onClick={saveAll}
                title={
                  rows.length === 0
                    ? "There is no RSVP, roll call, or clocked time to record yet."
                    : undefined
                }
              >
                Save this meeting&rsquo;s presence
              </Button>
              <p className="app-muted prs-tip">
                Writes one record per member who left a signal. Members with no signal are left alone.
              </p>
            </div>
          </Panel>

          {summary ? (
            <section className="prs-stats" aria-label="Presence figures">
              <StatTile
                label="Coming tonight"
                value={String(summary.comingTonight)}
                footer="RSVP + roll call + hours, counted once"
              />
              <StatTile label="Said going" value={String(summary.goingCount)} />
              <StatTile label="On the roll call" value={String(summary.presentCount)} />
              <StatTile label="Clocked hours" value={String(summary.clockedCount)} />
              <StatTile label="No record" value={String(summary.noRecordCount)} />
              <StatTile label="Needs a look" value={String(summary.discrepancyCount)} />
            </section>
          ) : null}

          {summary ? (
            <Panel className="prs-panel prs-figures" aria-label="Turnout">
              <Figure figure={summary.turnout} />
              <Figure figure={summary.responseRate} />
            </Panel>
          ) : null}

          <div className="prs-two-up">
            <Panel className="prs-panel" aria-label="Who is coming tonight">
              <h2 className="prs-panel-title">Coming tonight ({view.comingTonight})</h2>
              <p className="app-muted prs-tip">
                The same people from RSVP, the roll call, and clocked hours — each member once.
                {selected.recurring
                  ? " A repeating meeting RSVP is a standing series answer, not a promise about this night."
                  : ""}
              </p>
              {coming.length === 0 ? (
                <p className="app-muted prs-tip">
                  Nobody has said they are going, been marked present, or clocked time. That is not a
                  roster of absences.
                </p>
              ) : (
                <ul className="prs-list">
                  {coming.map((row) => (
                    <li key={row.userId} className="prs-row">
                      <span className="prs-name">{displayName(row)}</span>
                      <span className="prs-marks">
                        {row.rsvp === "going" ? (
                          <Badge tone="good">
                            {PRESENCE_RSVP_LABELS.going}
                            {row.rsvpScope === "series" ? " · series" : ""}
                          </Badge>
                        ) : row.rsvp != null ? (
                          <Badge tone={row.rsvp === "maybe" ? "info" : "neutral"}>
                            {PRESENCE_RSVP_LABELS[row.rsvp]}
                          </Badge>
                        ) : null}
                        {row.attended === true ? <Badge tone="good">On the roll call</Badge> : null}
                        {row.minutes != null && row.minutes > 0 ? (
                          <Badge tone="info">{formatMinutes(row.minutes)}</Badge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel className="prs-panel" aria-label="Who was here">
              <h2 className="prs-panel-title">Who was here</h2>
              <p className="app-muted prs-tip">
                {view.rollCall.taken
                  ? "From the roll call and any shop sessions attached to this meeting."
                  : "No roll call has been taken for this date yet, so nobody is marked present or absent."}
              </p>
              {here.length === 0 ? (
                <p className="app-muted prs-tip">
                  {view.rollCall.taken
                    ? "The roll call for this date lists nobody who is linked to a member account yet."
                    : "Take the roll in People, or attach a shop session below."}
                </p>
              ) : (
                <ul className="prs-list">
                  {here.map((row) => (
                    <li key={row.userId} className="prs-row">
                      <span className="prs-name">{displayName(row)}</span>
                      <span className="prs-marks">
                        {row.attended === true ? <Badge tone="good">On the roll call</Badge> : null}
                        {row.minutes != null && row.minutes > 0 ? (
                          <Badge tone="info">
                            {formatMinutes(row.minutes)}
                            {row.hasOpenSession ? " so far" : ""}
                          </Badge>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button as="a" variant="secondary" href={withOrgHref("/attendance", view.orgId)}>
                Take the roll in People
              </Button>
            </Panel>
          </div>

          <DiscrepancyPanel rows={view.discrepancies} busy={busy} mutate={mutate} />

          {view.noRecord.length > 0 ? (
            <Panel className="prs-panel" aria-label="No record">
              <h2 className="prs-panel-title">No record ({view.noRecord.length})</h2>
              <p className="app-muted prs-tip">
                These members left no RSVP, no roll-call entry, and no clocked time for this meeting.
                That is <strong>no record</strong> — Vantage will not call it absent.
              </p>
              <ul className="prs-chips">
                {view.noRecord.map((member) => (
                  <li key={member.userId}>{displayName(member)}</li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <UnlinkedHoursPanel logs={view.unlinkedHourLogs} busy={busy} mutate={mutate} />
        </>
      )}

      <UnmatchedNamesPanel
        names={view.unmatchedNames}
        canManage={view.canManage}
        busy={busy}
        mutate={mutate}
      />

      <Panel className="prs-panel" aria-label="Hours against the team goal">
        <h2 className="prs-panel-title">Hours against your team&rsquo;s goal</h2>
        <p className="app-muted prs-tip">
          Listed by name, never ranked. {view.goalHours == null
            ? "No season hour goal is set for this team yet, so there is nothing to measure against."
            : `The goal your team set is ${view.goalHours} hours.`}
        </p>
        {view.memberGoals.length === 0 ? (
          <p className="app-muted prs-tip">No closed shop sessions have been logged yet.</p>
        ) : (
          <ul className="prs-list">
            {view.memberGoals.map((row) => (
              <li key={row.userId} className="prs-row">
                <span className="prs-name">{displayName(row)}</span>
                <span className="prs-marks">
                  <span className="app-muted">{row.label}</span>
                  {row.percent != null ? <Badge tone="info">{row.percent}%</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}

function DiscrepancyPanel({
  rows,
  busy,
  mutate,
}: {
  rows: PresenceMemberRow[];
  busy: boolean;
  mutate: Mutate;
}) {
  if (rows.length === 0) return null;
  return (
    <Panel className="prs-panel" aria-label="Needs a look">
      <h2 className="prs-panel-title">Needs a look ({rows.length})</h2>
      <p className="app-muted prs-tip">
        The three stores disagree here. Each one is a question for a human, not a conclusion — resolving
        it writes exactly what you pick and nothing else.
      </p>
      <ul className="prs-list">
        {rows.map((row) => {
          const kind = row.discrepancy;
          if (kind == null) return null;
          return (
          <li key={row.userId} className="prs-row prs-flagged">
            <div className="prs-flag-main">
              <span className="prs-name">{displayName(row)}</span>
              <Badge tone="setup">{PRESENCE_DISCREPANCY_LABELS[kind]}</Badge>
              <p className="app-muted prs-tip">{PRESENCE_DISCREPANCY_DETAILS[kind]}</p>
            </div>
            <div className="prs-flag-actions">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() =>
                  mutate({
                    action: "record-presence",
                    targetUserId: row.userId,
                    rsvp: row.rsvp,
                    attended: true,
                    minutes: row.minutes,
                    hourLogId: row.hourLogIds[0] ?? null,
                    source: "manual",
                    note: "Confirmed present from the presence screen.",
                  })
                }
              >
                They were here
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  mutate({
                    action: "record-presence",
                    targetUserId: row.userId,
                    rsvp: row.rsvp,
                    attended: false,
                    minutes: row.minutes,
                    hourLogId: row.hourLogIds[0] ?? null,
                    source: "manual",
                    note: "Confirmed not here from the presence screen.",
                  })
                }
              >
                They were not
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() =>
                  mutate({
                    action: "record-presence",
                    targetUserId: row.userId,
                    rsvp: row.rsvp,
                    attended: null,
                    minutes: row.minutes,
                    hourLogId: row.hourLogIds[0] ?? null,
                    source: "manual",
                    note: "Left unresolved on purpose.",
                  })
                }
              >
                Don&rsquo;t know
              </Button>
            </div>
          </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function UnlinkedHoursPanel({
  logs,
  busy,
  mutate,
}: {
  logs: PresenceUnlinkedHourLog[];
  busy: boolean;
  mutate: Mutate;
}) {
  if (logs.length === 0) return null;
  return (
    <Panel className="prs-panel" aria-label="Shop sessions on this date">
      <h2 className="prs-panel-title">Shop sessions not attached to this meeting ({logs.length})</h2>
      <p className="app-muted prs-tip">
        Clocked on this date but not tied to a calendar occurrence. Attaching one is a claim that the
        session belongs to this meeting — drop-in work is fine to leave alone.
      </p>
      <ul className="prs-list">
        {logs.map((log) => (
          <li key={log.hourLogId} className="prs-row">
            <span className="prs-name">
              {displayName(log)}
              <span className="app-muted prs-sub">
                {formatTime(log.clockIn)}
                {log.clockOut ? `–${formatTime(log.clockOut)}` : " · still clocked in"}
                {` · ${formatMinutes(log.minutes)}`}
                {log.open ? " so far" : ""}
              </span>
            </span>
            <span className="prs-marks">
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => mutate({ action: "link-hour-log", hourLogId: log.hourLogId })}
              >
                Attach to this meeting
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function UnmatchedNamesPanel({
  names,
  canManage,
  busy,
  mutate,
}: {
  names: PresenceUnmatchedName[];
  canManage: boolean;
  busy: boolean;
  mutate: Mutate;
}) {
  if (names.length === 0) return null;
  return (
    <Panel className="prs-panel" aria-label="Unmatched roll-call names">
      <h2 className="prs-panel-title">Unmatched roll-call names ({names.length})</h2>
      <p className="app-muted prs-tip">
        Roll calls have been free text since 2023, so these entries join to nobody. A name is only ever
        linked when a person confirms it — Vantage never merges two people on a guess. Leaving a guest,
        parent, or alum unlinked is a valid answer.
      </p>
      <ul className="prs-list">
        {names.map((entry) => (
          <li key={entry.personName} className="prs-row prs-unmatched">
            <div className="prs-flag-main">
              <span className="prs-name">
                {entry.personName}
                <span className="app-muted prs-sub">
                  {entry.entryCount} entr{entry.entryCount === 1 ? "y" : "ies"}
                </span>
              </span>
              <Badge
                tone={
                  entry.resolution === "auto"
                    ? "good"
                    : entry.resolution === "ambiguous"
                      ? "setup"
                      : entry.resolution === "none"
                        ? "neutral"
                        : "info"
                }
              >
                {entry.resolution === "auto"
                  ? "Exact match"
                  : entry.resolution === "ambiguous"
                    ? "Needs a decision"
                    : entry.resolution === "none"
                      ? "No match"
                      : "Confirm"}
              </Badge>
              <p className="app-muted prs-tip">{entry.message}</p>
            </div>
            {canManage && entry.candidates.length > 0 ? (
              <div className="prs-flag-actions">
                {entry.candidates.slice(0, 4).map((candidate) => (
                  <Button
                    key={candidate.userId}
                    variant={candidate.confidence === "exact" ? "secondary" : "ghost"}
                    size="sm"
                    disabled={busy}
                    title={candidate.reason}
                    onClick={() =>
                      mutate({
                        action: "link-attendance-person",
                        personName: entry.personName,
                        targetUserId: candidate.userId,
                      })
                    }
                  >
                    Link to {candidate.name}
                  </Button>
                ))}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {!canManage ? (
        <p className="app-muted prs-tip">Owners and admins resolve these.</p>
      ) : null}
    </Panel>
  );
}
