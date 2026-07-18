"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "../../components/ui";
import { TeamHubRelated } from "../../components/team-hub-related";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { hubHref } from "../../lib/nav/hubs";
import {
  ATTENDANCE_KIND_LABELS,
  ATTENDANCE_KINDS,
  ATTENDANCE_ROLE_LABELS,
  ATTENDANCE_ROLES,
  defaultSeasonYear,
  personAttendanceBoard,
  summarizeAttendance,
  type AttendanceEvent,
  type AttendanceKind,
  type AttendanceMember,
  type AttendanceRole,
  type AttendanceView,
} from "../../lib/attendance";
import "./attendance.css";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function fmtDate(ymd: string): string {
  const date = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function CreateEventForm({
  orgId,
  seasonYear,
  busy,
  run,
}: {
  orgId: string;
  seasonYear: number;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<AttendanceKind>("practice");
  const [occurredOn, setOccurredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [creditHours, setCreditHours] = useState("2");

  return (
    <form
      className="att-create soft-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !occurredOn) return;
        void run(
          {
            action: "create_event",
            orgId,
            title: title.trim(),
            kind,
            occurredOn,
            creditHours: creditHours === "" ? 0 : Number(creditHours),
            seasonYear,
          },
          "create",
        ).then(() => setTitle(""));
      }}
    >
      <h3>New attendance event</h3>
      <div className="att-form-grid">
        <label className="att-field wide">
          <span>Title</span>
          <input value={title} disabled={busy} placeholder="Tuesday practice" required onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="att-field">
          <span>Kind</span>
          <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as AttendanceKind)}>
            {ATTENDANCE_KINDS.map((value) => (
              <option key={value} value={value}>
                {ATTENDANCE_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="att-field">
          <span>Date</span>
          <input type="date" value={occurredOn} disabled={busy} required onChange={(e) => setOccurredOn(e.target.value)} />
        </label>
        <label className="att-field">
          <span>Default credit hours</span>
          <input
            type="number"
            min={0}
            max={24}
            step="0.25"
            value={creditHours}
            disabled={busy}
            onChange={(e) => setCreditHours(e.target.value)}
          />
        </label>
      </div>
      <button type="submit" className="app-button" disabled={busy || !title.trim() || !occurredOn}>
        Create event
      </button>
    </form>
  );
}

function EventCard({
  event,
  canManage,
  selected,
  busy,
  orgId,
  members,
  onSelect,
  run,
}: {
  event: AttendanceEvent;
  canManage: boolean;
  selected: boolean;
  busy: boolean;
  orgId: string;
  members: AttendanceMember[];
  onSelect: () => void;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const [personName, setPersonName] = useState("");
  const [role, setRole] = useState<AttendanceRole>("student");
  const [hours, setHours] = useState("");

  const marked = useMemo(
    () => new Set(event.entries.map((entry) => entry.personName.trim().toLowerCase())),
    [event.entries],
  );
  const suggestions = useMemo(
    () => members.filter((member) => !marked.has(member.name.trim().toLowerCase())).slice(0, 12),
    [members, marked],
  );

  const addPerson = (name: string, nextRole: AttendanceRole = role) => {
    if (!name.trim()) return;
    void run(
      {
        action: "add_entry",
        orgId,
        eventId: event.id,
        personName: name.trim(),
        role: nextRole,
        hours: hours === "" ? null : Number(hours),
      },
      `add:${event.id}`,
    ).then(() => {
      setPersonName("");
      setHours("");
    });
  };

  return (
    <li className={`att-event soft-panel${selected ? " active" : ""}`}>
      <div className="att-event-head">
        <div>
          <h3>
            <button type="button" className="att-link" onClick={onSelect}>
              {event.title}
            </button>
          </h3>
          <p>
            {fmtDate(event.occurredOn)}
            {event.creditHours > 0 ? ` · ${event.creditHours}h credit` : ""}
            {event.createdByName ? ` · logged by ${event.createdByName}` : ""}
          </p>
        </div>
        <span className="att-kind">{ATTENDANCE_KIND_LABELS[event.kind] ?? event.kind}</span>
      </div>

      <div className="att-meta">
        <span>
          Present <b>{event.entries.length}</b>
        </span>
        <span>
          Hours <b>{event.entries.reduce((sum, entry) => sum + (entry.hours ?? event.creditHours), 0).toFixed(1)}</b>
        </span>
        {event.kind === "practice" ? (
          <a className="att-link" href={hubHref("/team", "practice", orgId)}>
            Practice planner →
          </a>
        ) : null}
      </div>

      {selected ? (
        <>
          {canManage ? (
            <>
              <form
                className="att-add"
                onSubmit={(formEvent) => {
                  formEvent.preventDefault();
                  addPerson(personName);
                }}
              >
                <h3>Mark present</h3>
                {suggestions.length > 0 ? (
                  <div className="att-suggestions" aria-label="Team members not yet marked">
                    {suggestions.map((member) => (
                      <button
                        key={member.userId}
                        type="button"
                        className="att-chip"
                        disabled={busy}
                        onClick={() => addPerson(member.name)}
                      >
                        {member.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="att-form-grid">
                  <label className="att-field wide">
                    <span>Name</span>
                    <input
                      list={`att-members-${event.id}`}
                      value={personName}
                      disabled={busy}
                      placeholder="First Last"
                      required
                      onChange={(e) => setPersonName(e.target.value)}
                    />
                    <datalist id={`att-members-${event.id}`}>
                      {members.map((member) => (
                        <option key={member.userId} value={member.name} />
                      ))}
                    </datalist>
                  </label>
                  <label className="att-field">
                    <span>Role</span>
                    <select value={role} disabled={busy} onChange={(e) => setRole(e.target.value as AttendanceRole)}>
                      {ATTENDANCE_ROLES.map((value) => (
                        <option key={value} value={value}>
                          {ATTENDANCE_ROLE_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="att-field">
                    <span>Hours (optional)</span>
                    <input
                      type="number"
                      min={0}
                      max={24}
                      step="0.25"
                      value={hours}
                      disabled={busy}
                      placeholder={String(event.creditHours || "")}
                      onChange={(e) => setHours(e.target.value)}
                    />
                  </label>
                </div>
                <button type="submit" className="app-button secondary" disabled={busy || !personName.trim()}>
                  Add attendee
                </button>
              </form>
              <button
                type="button"
                className="att-link danger"
                disabled={busy}
                onClick={() => {
                  if (confirm(`Delete “${event.title}” and all attendees?`)) {
                    void run({ action: "delete_event", orgId, id: event.id }, `del:${event.id}`);
                  }
                }}
              >
                Delete event
              </button>
            </>
          ) : null}

          {event.entries.length === 0 ? (
            <EmptyState soft title="No attendees marked yet" description="Add people who showed up — totals stay empty until you mark them." />
          ) : (
            <ul className="att-entries">
              {event.entries.map((entry) => (
                <li key={entry.id}>
                  <span className="who">
                    <strong>{entry.personName}</strong>
                    <small>{ATTENDANCE_ROLE_LABELS[entry.role]}</small>
                  </span>
                  <span className="hrs">{(entry.hours ?? event.creditHours) || "—"}h</span>
                  {canManage ? (
                    <button
                      type="button"
                      className="att-link danger"
                      disabled={busy}
                      aria-label={`Remove ${entry.personName}`}
                      onClick={() => void run({ action: "delete_entry", orgId, id: entry.id }, `del-entry:${entry.id}`)}
                    >
                      ✕
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <button type="button" className="att-link" onClick={onSelect}>
          Open roll →
        </button>
      )}
    </li>
  );
}

export default function AttendanceClient() {
  const [view, setView] = useState<AttendanceView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear);

  const load = useCallback(async (year = seasonYear) => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const focusEventId = params.get("eventId");
    const focusOccurredOn = params.get("occurredOn");
    try {
      const query = new URLSearchParams();
      if (orgId) query.set("orgId", orgId);
      query.set("seasonYear", String(year));
      const response = await fetch(`/api/attendance?${query}`);
      const data = (await response.json()) as AttendanceView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load attendance.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      if (data.status === "ready") {
        setSeasonYear(data.seasonYear);
        if (data.events.length) {
          setSelectedId((current) => {
            if (focusEventId && data.events.some((event) => event.id === focusEventId)) return focusEventId;
            if (focusOccurredOn) {
              const byDate = data.events.find((event) => event.occurredOn === focusOccurredOn);
              if (byDate) return byDate.id;
            }
            return current ?? data.events[0]!.id;
          });
        }
      }
    } catch {
      setFetchFailed(true);
    }
  }, [seasonYear]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/attendance", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string; id?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        if (body.action === "create_event" && data.id) setSelectedId(data.id);
        if (body.action === "delete_event" && body.id === selectedId) setSelectedId(null);
        await load();
      } catch {
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load, selectedId],
  );

  if (fetchFailed || !view) {
    return (
      <main className="module-page att-page">
        <PageHeader breadcrumbs="Team / Attendance" title="Attendance" />
        <TeamOpsNav active="attendance" />
        <EmptyState
          title={fetchFailed ? "Could not load attendance" : "Loading attendance…"}
          description={fetchFailed ? error || "Check your connection and try again." : undefined}
          aria-busy={!fetchFailed}
        >
          {fetchFailed ? (
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page att-page">
        <PageHeader
          breadcrumbs="Team / Attendance"
          title="Attendance"
          description="Log who showed up to practice and meetings — real marks only."
        />
        <TeamOpsNav active="attendance" />
        <EmptyState title="Select a team workspace" description={view.message} badge="Setup" badgeTone="setup">
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </EmptyState>
      </main>
    );
  }

  const { context, events, seasons, members } = view;
  const orgId = context.orgId ?? "";
  const canManage = context.canManage;
  const summary = summarizeAttendance(events);
  const board = personAttendanceBoard(events);
  const busy = busyKey != null;
  const selected = events.find((event) => event.id === selectedId) ?? null;

  return (
    <main className="module-page att-page">
      <PageHeader
        breadcrumbs="Team / Attendance"
        title="Attendance"
        description={
          <>
            Practice and meeting presence for {context.orgName ?? "your team"}
            {context.teamNumber ? ` (Team ${context.teamNumber})` : ""}. Totals use only marks you enter.
          </>
        }
      >
        <div className="att-header-actions">
          <label className="att-season">
            Season
            <select
              value={seasonYear}
              disabled={busy}
              onChange={(e) => {
                const year = Number(e.target.value);
                setSeasonYear(year);
                setSelectedId(null);
                void load(year);
              }}
            >
              {seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <a className="app-button secondary" href={hubHref("/team", "practice", orgId)}>
            Practice
          </a>
          <a className="app-button secondary" href={hubHref("/team", "calendar", orgId)}>
            Calendar
          </a>
        </div>
      </PageHeader>
      <TeamOpsNav orgId={orgId} active="attendance" />
      <TeamHubRelated orgId={orgId} active="attendance" />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <section className="att-summary" aria-label="Attendance summary">
        <div className="att-summary-tile">
          <strong>{summary.eventCount}</strong>
          <span>Events</span>
        </div>
        <div className="att-summary-tile">
          <strong>{summary.entryCount}</strong>
          <span>Marks</span>
        </div>
        <div className="att-summary-tile">
          <strong>{summary.uniquePeople}</strong>
          <span>People</span>
        </div>
        <div className="att-summary-tile">
          <strong>{summary.totalHours}</strong>
          <span>Credited hours</span>
        </div>
      </section>

      <div className="att-layout">
        <section className="att-panel">
          <h2>Events · {seasonYear}</h2>
          {canManage ? <CreateEventForm orgId={orgId} seasonYear={seasonYear} busy={busy} run={run} /> : null}
          {events.length === 0 ? (
            <EmptyState
              soft
              title="No attendance events this season"
              description={
                canManage
                  ? "Create a practice or meeting event, then mark who was present. Nothing is invented until you log it."
                  : "An owner or admin will create the first roll-call event."
              }
            >
              {canManage ? null : (
                <a className="app-button secondary" href={hubHref("/team", "messages", orgId)}>
                  Ask in Messages
                </a>
              )}
            </EmptyState>
          ) : (
            <ul className="att-events">
              {events.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  canManage={canManage}
                  selected={selected?.id === event.id}
                  busy={busy}
                  orgId={orgId}
                  members={members}
                  onSelect={() => setSelectedId(event.id)}
                  run={run}
                />
              ))}
            </ul>
          )}
        </section>

        <aside className="att-panel">
          <h2>Season presence</h2>
          {board.length === 0 ? (
            <EmptyState soft title="Board is empty" description="No marks yet — the board stays empty until someone is added to an event." />
          ) : (
            <ul className="att-board">
              {board.map((row, index) => (
                <li key={row.personName}>
                  <span className="rank">{index + 1}</span>
                  <span className="who">{row.personName}</span>
                  <span className="total">{row.events}</span>
                  <span className="detail">
                    {row.events} event{row.events === 1 ? "" : "s"} · {row.totalHours}h
                    {row.mentorEvents ? ` · ${row.mentorEvents} mentor` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  );
}
