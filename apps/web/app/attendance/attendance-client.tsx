"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { TeamHubRelated } from "../../components/team-hub-related";
import { TeamOpsNav } from "../../components/team-ops-nav";
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
import {
  ATTENDANCE_LIST_FILTERS,
  ATTENDANCE_TEAM_RELATED_INCLUDE,
  attendanceCalendarHref,
  attendanceNextActions,
  attendancePracticeHref,
  filterAttendanceEvents,
  formatEventEvidence,
  membersNotMarked,
  pickDefaultSession,
  type AttendanceListFilter,
} from "../../lib/attendance/attendance-related";
import "./attendance.css";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };

function fmtDate(ymd: string): string {
  const date = new Date(`${ymd}T12:00:00`);
  if (Number.isNaN(date.getTime())) return ymd;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function NextActions({
  orgId,
  eventCount,
  emptyRollCount,
  canManage,
  selectedEventId,
  selectedOccurredOn,
}: {
  orgId?: string | null;
  eventCount: number;
  emptyRollCount: number;
  canManage: boolean;
  selectedEventId?: string | null;
  selectedOccurredOn?: string | null;
}) {
  const actions = attendanceNextActions({
    orgId,
    eventCount,
    emptyRollCount,
    canManage,
    selectedEventId,
    selectedOccurredOn,
  });
  if (actions.length === 0) return null;
  return (
    <section className="att-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
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
      <Button variant="primary" type="submit" disabled={busy || !title.trim() || !occurredOn}>
        Create event
      </Button>
    </form>
  );
}

function MemberOneTap({
  event,
  members,
  canManage,
  busy,
  orgId,
  role,
  hours,
  run,
}: {
  event: AttendanceEvent;
  members: AttendanceMember[];
  canManage: boolean;
  busy: boolean;
  orgId: string;
  role: AttendanceRole;
  hours: string;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const markedByMember = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of event.entries) {
      if (entry.userId) map.set(entry.userId, entry.id);
    }
    return map;
  }, [event.entries]);

  if (members.length === 0) {
    return (
      <EmptyState
        soft
        title="No roster members yet"
        description="One-tap marks use real workspace members. Invite teammates, or type a name below."
      />
    );
  }

  return (
    <div className="att-one-tap" aria-label="Team members one-tap roll call">
      <header>
        <h3>One-tap roll</h3>
        <p>Tap a teammate to mark present — remove with another tap.</p>
      </header>
      <div className="att-one-tap-grid">
        {members.map((member) => {
          const entryId = markedByMember.get(member.userId);
          const present = Boolean(entryId);
          return (
            <button
              key={member.userId}
              type="button"
              className={present ? "att-tap present" : "att-tap"}
              disabled={busy || !canManage}
              aria-pressed={present}
              onClick={() => {
                if (!canManage) return;
                if (entryId) {
                  void run({ action: "delete_entry", orgId, id: entryId }, `tap-off:${entryId}`);
                } else {
                  void run(
                    {
                      action: "add_entry",
                      orgId,
                      eventId: event.id,
                      userId: member.userId,
                      personName: member.name.trim(),
                      role,
                      hours: hours === "" ? null : Number(hours),
                    },
                    `tap-on:${member.userId}`,
                  );
                }
              }}
            >
              <strong>{member.name}</strong>
              <span>{present ? "Present" : "Tap to mark"}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SessionDetail({
  event,
  canManage,
  busy,
  orgId,
  members,
  run,
}: {
  event: AttendanceEvent;
  canManage: boolean;
  busy: boolean;
  orgId: string;
  members: AttendanceMember[];
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const [personName, setPersonName] = useState("");
  const [role, setRole] = useState<AttendanceRole>("student");
  const [hours, setHours] = useState("");
  const openMembers = membersNotMarked(members, event);

  const addPerson = (name: string, nextRole: AttendanceRole = role, userId: string | null = null) => {
    if (!name.trim()) return;
    void run(
      {
        action: "add_entry",
        orgId,
        eventId: event.id,
        userId,
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
    <article className="att-detail soft-panel">
      <div className="att-event-head">
        <div>
          <h2>{event.title}</h2>
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
          Hours{" "}
          <b>{event.entries.reduce((sum, entry) => sum + (entry.hours ?? event.creditHours), 0).toFixed(1)}</b>
        </span>
        {openMembers.length > 0 ? (
          <span>
            Unmarked <b>{openMembers.length}</b>
          </span>
        ) : null}
        {event.kind === "practice" ? (
          <a className="att-link" href={attendancePracticeHref(orgId)}>
            Practice planner →
          </a>
        ) : (
          <a className="att-link" href={attendanceCalendarHref(orgId)}>
            Calendar →
          </a>
        )}
      </div>

      {canManage ? (
        <>
          <MemberOneTap
            event={event}
            members={members}
            canManage={canManage}
            busy={busy}
            orgId={orgId}
            role={role}
            hours={hours}
            run={run}
          />
          <form
            className="att-add"
            onSubmit={(formEvent) => {
              formEvent.preventDefault();
              addPerson(personName);
            }}
          >
            <h3>Add by name</h3>
            {openMembers.length > 0 ? (
              <div className="att-suggestions" aria-label="Team members not yet marked">
                {openMembers.slice(0, 16).map((member) => (
                  <button
                    key={member.userId}
                    type="button"
                    className="att-chip"
                    disabled={busy}
                    onClick={() => addPerson(member.name, role, member.userId)}
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
            <Button variant="secondary" type="submit" disabled={busy || !personName.trim()}>
              Add attendee
            </Button>
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
        <EmptyState
          soft
          title="No attendees marked yet"
          description="Add people who showed up — totals stay empty until you mark them."
        >
          <div className="att-empty-actions">
            <Button as="a" variant="secondary" href={attendancePracticeHref(orgId)}>
              Practice
            </Button>
            <Button as="a" variant="secondary" href={attendanceCalendarHref(orgId)}>
              Calendar
            </Button>
          </div>
        </EmptyState>
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
    </article>
  );
}

export default function AttendanceClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<AttendanceView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [seasonYear, setSeasonYear] = useState(defaultSeasonYear);
  const [listFilter, setListFilter] = useState<AttendanceListFilter>("all");
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (year = seasonYear) => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    const focusEventId = params.get("eventId");
    const focusOccurredOn = params.get("occurredOn");
    const focusSeason = params.get("seasonYear");
    const yearToLoad = focusSeason && Number.isInteger(Number(focusSeason)) ? Number(focusSeason) : year;
    try {
      const search = new URLSearchParams();
      if (orgId) search.set("orgId", orgId);
      search.set("seasonYear", String(yearToLoad));
      const response = await fetch(`/api/attendance?${search}`);
      const data = (await response.json()) as AttendanceView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load attendance.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setView(data);
      if (data.status === "ready") {
        setSeasonYear(data.seasonYear);
        setSelectedId((current) =>
          pickDefaultSession(data.events, {
            eventId: focusEventId,
            occurredOn: focusOccurredOn,
            currentId: current,
          }),
        );
      }
    } catch {
      setErrorStatus(null);
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
        if (body.action === "create_event" && data.id) {
          setSelectedId(data.id);
          setShowCreate(false);
        }
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
    const failure = fetchFailed
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
            message:
              error || "Check your connection and try again.",
          },
        )
      : null;
    return (
      <main className={`module-page att-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <>
            <PageHeader breadcrumbs="Team / Attendance" title="Attendance" />
            <TeamOpsNav active="attendance" />
          </>
        ) : null}
        <EmptyState
          soft
          badge={fetchFailed ? "Setup" : undefined}
          badgeTone={fetchFailed ? "setup" : undefined}
          title={failure ? failure.title : "Loading attendance…"}
          description={failure ? failure.description : "Checking your team for real roll calls."}
          aria-busy={!fetchFailed}
        >
          {failure ? (
            <div className="att-empty-actions">
              {failure.primary ? (
                <Button as="a" variant="primary" href={failure.primary.href}>
                  {failure.primary.label}
                </Button>
              ) : null}
              {failure.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => void load()}>
                  Retry
                </Button>
              ) : null}
              <Button as="a" variant="secondary" href="/workspace">
                Choose your team
              </Button>
            </div>
          ) : null}
          {fetchFailed ? (
            <NextActions orgId={null} eventCount={0} emptyRollCount={0} canManage={false} />
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className={`module-page att-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <>
            <PageHeader
              breadcrumbs="Team / Attendance"
              title="Attendance"
              description="Log who showed up to practice and meetings — real marks only."
            />
            <TeamOpsNav active="attendance" />
          </>
        ) : null}
        <EmptyState soft title="Select a team" description={view.message} badge="Setup" badgeTone="setup">
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
        <NextActions orgId={null} eventCount={0} emptyRollCount={0} canManage={false} />
      </main>
    );
  }

  const { context, events, seasons, members } = view;
  const orgId = context.orgId ?? "";
  const canManage = context.canManage;
  const summary = summarizeAttendance(events);
  const board = personAttendanceBoard(events);
  const busy = busyKey != null;
  const emptyRollCount = events.filter((event) => event.entries.length === 0).length;
  const filtered = filterAttendanceEvents(events, listFilter, { members, query });
  const selected =
    filtered.find((event) => event.id === selectedId) ??
    events.find((event) => event.id === selectedId) ??
    filtered[0] ??
    null;

  const headerActions = (
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
      {!embedded ? (
        <>
          <Button as="a" variant="secondary" href={attendancePracticeHref(orgId)}>
            Practice
          </Button>
          <Button as="a" variant="secondary" href={attendanceCalendarHref(orgId)}>
            Calendar
          </Button>
        </>
      ) : null}
      {canManage ? (
        <Button variant="primary" type="button" onClick={() => setShowCreate((v) => !v)}>
          {showCreate ? "Cancel" : "New"}
        </Button>
      ) : null}
    </div>
  );

  return (
    <main className={`module-page att-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
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
          {headerActions}
        </PageHeader>
      ) : (
        headerActions
      )}
      {!embedded ? (
        <>
          <TeamOpsNav orgId={orgId} active="attendance" />
          <TeamHubRelated
            orgId={orgId}
            active="attendance"
            include={[...ATTENDANCE_TEAM_RELATED_INCLUDE]}
            ariaLabel="Related team ops for attendance"
          />
        </>
      ) : null}

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

      {events.length === 0 || emptyRollCount > 0 ? (
        <NextActions
          orgId={orgId}
          eventCount={events.length}
          emptyRollCount={emptyRollCount}
          canManage={canManage}
          selectedEventId={selected?.id}
          selectedOccurredOn={selected?.occurredOn}
        />
      ) : null}

      {showCreate && canManage ? (
        <CreateEventForm orgId={orgId} seasonYear={seasonYear} busy={busy} run={run} />
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          soft
          title="No attendance events this season"
          description={
            canManage
              ? "Create a practice or meeting event, then one-tap who was present. Nothing is invented until you log it."
              : "An owner or admin will create the first roll-call event."
          }
        >
          <div className="att-empty-actions">
            {canManage ? (
              <Button variant="primary" type="button" onClick={() => setShowCreate(true)}>
                New
              </Button>
            ) : (
              <Button as="a" variant="secondary" href={`/team?tab=messages&orgId=${encodeURIComponent(orgId)}`}>
                Ask in Messages
              </Button>
            )}
            <Button as="a" variant="secondary" href={attendanceCalendarHref(orgId)}>
              Schedule on Calendar
            </Button>
            <Button as="a" variant="secondary" href={attendancePracticeHref(orgId)}>
              Open Practice
            </Button>
          </div>
        </EmptyState>
      ) : (
        <>
          <div className="att-toolbar" role="search">
            <div className="att-filters" aria-label="Filter attendance events">
              {ATTENDANCE_LIST_FILTERS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className={listFilter === option.id ? "att-filter active" : "att-filter"}
                  aria-pressed={listFilter === option.id}
                  onClick={() => setListFilter(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="att-search">
              <span className="visually-hidden">Search events</span>
              <input
                value={query}
                disabled={busy}
                placeholder="Search title, kind, or name"
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>

          <div className="att-layout">
            <aside className="att-session-picker" aria-label="Attendance sessions">
              <header className="att-picker-head">
                <h2>Sessions · {seasonYear}</h2>
                <p>
                  {filtered.length} of {events.length} · evidence from marks only
                </p>
              </header>
              {filtered.length === 0 ? (
                <EmptyState soft title="No sessions match" description="Clear the filters or try a different search.">
                  <Button variant="secondary" type="button" onClick={() => { setListFilter("all"); setQuery(""); }}>
                    Reset filters
                  </Button>
                </EmptyState>
              ) : (
                <ul className="att-sessions">
                  {filtered.map((event) => {
                    const active = selected?.id === event.id;
                    return (
                      <li key={event.id}>
                        <button
                          type="button"
                          className={active ? "att-session active" : "att-session"}
                          onClick={() => setSelectedId(event.id)}
                        >
                          <div className="att-session-top">
                            <strong>{event.title}</strong>
                            <span className="att-kind">{ATTENDANCE_KIND_LABELS[event.kind]}</span>
                          </div>
                          <div className="att-session-sub">{fmtDate(event.occurredOn)}</div>
                          <p className="att-session-evidence">{formatEventEvidence(event)}</p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <section className="att-panel">
              {selected ? (
                <SessionDetail
                  key={selected.id}
                  event={selected}
                  canManage={canManage}
                  busy={busy}
                  orgId={orgId}
                  members={members}
                  run={run}
                />
              ) : (
                <EmptyState soft title="Pick a session" description="Choose a roll call from the session list to mark who showed up." />
              )}
            </section>

            <aside className="att-panel att-board-panel">
              <h2>Season presence</h2>
              {board.length === 0 ? (
                <EmptyState
                  soft
                  title="Board is empty"
                  description="No marks yet — the board stays empty until someone is added to an event."
                />
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
        </>
      )}
    </main>
  );
}
