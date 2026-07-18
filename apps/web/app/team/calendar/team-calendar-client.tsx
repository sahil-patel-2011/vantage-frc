"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  filterEventsBySubteam,
  groupEventsByDay,
  SUBTEAM_COLOR_SUGGESTIONS,
  SUBTEAM_EVENT_KIND_LABELS,
  SUBTEAM_EVENT_KINDS,
  upcomingEvents,
  type CalendarEvent,
  type Subteam,
  type SubteamCalendarView,
  type SubteamEventKind,
  type SubteamMemberLite,
} from "../../../lib/subteam-calendar";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type ReadyView = Extract<SubteamCalendarView, { status: "ready" }>;
type Tab = "calendar" | "subteams";

function withOrg(path: string, orgId: string) {
  const join = path.includes("?") ? "&" : "?";
  return `${path}${join}orgId=${encodeURIComponent(orgId)}`;
}

function fmtWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function EventCard({
  event,
  orgId,
  busy,
  canDelete,
  onDelete,
}: {
  event: CalendarEvent;
  orgId: string;
  busy: boolean;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const accent = event.subteamColor ?? "var(--app-accent)";
  return (
    <article className="tc-event" style={{ ["--tc-accent" as string]: accent }}>
      <div className="tc-event-top">
        <strong>{event.title}</strong>
        {canDelete ? (
          <button type="button" className="tc-text-btn" disabled={busy} onClick={onDelete}>
            Remove
          </button>
        ) : null}
      </div>
      <div className="tc-event-meta">
        <span className="tc-chip">{SUBTEAM_EVENT_KIND_LABELS[event.kind]}</span>
        <span>{fmtWhen(event.startsAt)}{event.endsAt ? ` → ${fmtWhen(event.endsAt)}` : ""}</span>
        {event.subteamName ? <span style={{ color: accent }}>{event.subteamName}</span> : <span>Whole team</span>}
        {event.location ? <span>{event.location}</span> : null}
      </div>
      {event.notes ? <p className="tc-muted">{event.notes}</p> : null}
      <div className="tc-links">
        {event.attendanceEventId ? (
          <a href={withOrg("/attendance", orgId)}>Attendance: {event.attendanceEventTitle ?? "open roll call"} →</a>
        ) : null}
        {event.driverSessionId ? <a href={withOrg("/practice", orgId)}>Practice session →</a> : null}
        {event.milestoneId ? <a href={withOrg("/calendar", orgId)}>Season milestone →</a> : null}
      </div>
    </article>
  );
}

function CreateEventForm({
  orgId,
  subteams,
  attendanceEvents,
  practiceSessions,
  filterSubteamId,
  busy,
  run,
}: {
  orgId: string;
  subteams: Subteam[];
  attendanceEvents: ReadyView["attendanceEvents"];
  practiceSessions: ReadyView["practiceSessions"];
  filterSubteamId: string | null;
  busy: boolean;
  run: (body: ActionBody, key: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SubteamEventKind>("practice");
  const [startsAt, setStartsAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [subteamId, setSubteamId] = useState(filterSubteamId ?? "");
  const [createAttendance, setCreateAttendance] = useState(kind === "practice" || kind === "build");
  const [attendanceEventId, setAttendanceEventId] = useState("");
  const [driverSessionId, setDriverSessionId] = useState("");

  useEffect(() => {
    setSubteamId(filterSubteamId ?? "");
  }, [filterSubteamId]);

  useEffect(() => {
    if (kind === "practice" || kind === "build") setCreateAttendance(true);
  }, [kind]);

  return (
    <form
      className="tc-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim() || !startsAt) return;
        void run(
          {
            action: "create_event",
            orgId,
            title: title.trim(),
            kind,
            startsAt: new Date(startsAt).toISOString(),
            endsAt: endsAt ? new Date(endsAt).toISOString() : null,
            location,
            notes,
            subteamId: subteamId || null,
            createAttendance: createAttendance && !attendanceEventId,
            attendanceEventId: attendanceEventId || null,
            driverSessionId: driverSessionId || null,
          },
          "create-event",
        ).then((ok) => {
          if (ok) {
            setTitle("");
            setNotes("");
            setLocation("");
          }
        });
      }}
    >
      <h2>Schedule</h2>
      <p className="tc-muted">Practices, build sessions, deadlines, and events — optionally tied to attendance or practice logs.</p>
      <div className="tc-form-grid">
        <label className="tc-field wide">
          <span>Title</span>
          <input value={title} disabled={busy} required placeholder="Tuesday mech build" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="tc-field">
          <span>Kind</span>
          <select value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as SubteamEventKind)}>
            {SUBTEAM_EVENT_KINDS.map((value) => (
              <option key={value} value={value}>
                {SUBTEAM_EVENT_KIND_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="tc-field">
          <span>Subteam</span>
          <select value={subteamId} disabled={busy} onChange={(e) => setSubteamId(e.target.value)}>
            <option value="">Whole team</option>
            {subteams.map((st) => (
              <option key={st.id} value={st.id}>
                {st.name}
              </option>
            ))}
          </select>
        </label>
        <label className="tc-field">
          <span>Starts</span>
          <input type="datetime-local" value={startsAt} disabled={busy} required onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="tc-field">
          <span>Ends</span>
          <input type="datetime-local" value={endsAt} disabled={busy} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
        <label className="tc-field wide">
          <span>Location</span>
          <input value={location} disabled={busy} placeholder="Shop / Room 12" onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="tc-field wide">
          <span>Notes</span>
          <textarea value={notes} disabled={busy} placeholder="Goals, packing list, or agenda" onChange={(e) => setNotes(e.target.value)} />
        </label>
        {attendanceEvents.length > 0 ? (
          <label className="tc-field wide">
            <span>Link existing attendance</span>
            <select
              value={attendanceEventId}
              disabled={busy}
              onChange={(e) => {
                setAttendanceEventId(e.target.value);
                if (e.target.value) setCreateAttendance(false);
              }}
            >
              <option value="">None</option>
              {attendanceEvents.map((ae) => (
                <option key={ae.id} value={ae.id}>
                  {ae.occurredOn} · {ae.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {practiceSessions.length > 0 ? (
          <label className="tc-field wide">
            <span>Link practice session</span>
            <select value={driverSessionId} disabled={busy} onChange={(e) => setDriverSessionId(e.target.value)}>
              <option value="">None</option>
              {practiceSessions.map((ps) => (
                <option key={ps.id} value={ps.id}>
                  {ps.sessionDate} · {ps.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {!attendanceEventId ? (
        <label className="tc-check">
          <input
            type="checkbox"
            checked={createAttendance}
            disabled={busy}
            onChange={(e) => setCreateAttendance(e.target.checked)}
          />
          <span>Also create an attendance roll-call for this date</span>
        </label>
      ) : null}
      <button type="submit" className="app-button" disabled={busy || !title.trim() || !startsAt}>
        Add to calendar
      </button>
    </form>
  );
}

function SubteamsPanel({
  orgId,
  subteams,
  members,
  busyKey,
  run,
}: {
  orgId: string;
  subteams: Subteam[];
  members: SubteamMemberLite[];
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<boolean>;
}) {
  const busy = busyKey != null;
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(SUBTEAM_COLOR_SUGGESTIONS[0]);
  const [description, setDescription] = useState("");

  const toggleMemberSubteam = (member: SubteamMemberLite, subteamId: string) => {
    const next = member.subteamIds.includes(subteamId)
      ? member.subteamIds.filter((id) => id !== subteamId)
      : [...member.subteamIds, subteamId];
    void run({ action: "set_member_subteams", orgId, userId: member.userId, subteamIds: next }, `m:${member.userId}`);
  };

  return (
    <div className="tc-layout">
      <section className="tc-panel">
        <form
          className="tc-sub-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run({ action: "create_subteam", orgId, name: name.trim(), color, description }, "create-subteam").then(
              (ok) => {
                if (ok) {
                  setName("");
                  setDescription("");
                }
              },
            );
          }}
        >
          <h2>Create a subteam</h2>
          <p className="tc-muted">Mechanical, Electrical, Programming, Business, Drive — whatever your team uses. Nothing is seeded for you.</p>
          <label className="tc-field">
            <span>Name</span>
            <input value={name} disabled={busy} placeholder="Programming" required onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="tc-color-row" role="group" aria-label="Color">
            {SUBTEAM_COLOR_SUGGESTIONS.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={color === swatch ? "tc-color active" : "tc-color"}
                style={{ background: swatch }}
                aria-label={swatch}
                onClick={() => setColor(swatch)}
              />
            ))}
          </div>
          <label className="tc-field">
            <span>Description</span>
            <input value={description} disabled={busy} placeholder="Optional" onChange={(e) => setDescription(e.target.value)} />
          </label>
          <button type="submit" className="app-button" disabled={busy || !name.trim()}>
            Create subteam
          </button>
        </form>

        {subteams.length > 0 ? (
          <ul className="tc-sub-list">
            {subteams.map((st) => (
              <li key={st.id}>
                <span className="tc-sub-name">
                  <i className="tc-dot" style={{ background: st.color }} />
                  {st.name}
                  <span className="tc-muted">{st.memberCount} members</span>
                </span>
                <button
                  type="button"
                  className="tc-text-btn"
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`Delete subteam “${st.name}”? Calendar events for it are removed; people stay on the team.`)) {
                      void run({ action: "delete_subteam", orgId, id: st.id }, `st:${st.id}`);
                    }
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="tc-muted">No subteams yet — create the first one above.</p>
        )}
      </section>

      <section className="tc-panel">
        <h2>Assign members</h2>
        {subteams.length === 0 ? (
          <p className="tc-muted">Create a subteam before assigning people.</p>
        ) : members.length === 0 ? (
          <p className="tc-muted">No members on this team yet.</p>
        ) : (
          <table className="tc-roster">
            <thead>
              <tr>
                <th>Member</th>
                <th>Subteams</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <div>{member.name || member.email || "Member"}</div>
                    <div className="tc-muted">{member.role}</div>
                  </td>
                  <td>
                    {subteams.map((st) => {
                      const on = member.subteamIds.includes(st.id);
                      return (
                        <button
                          key={st.id}
                          type="button"
                          className={on ? "tc-toggle on" : "tc-toggle"}
                          style={on ? { background: st.color } : undefined}
                          disabled={busyKey === `m:${member.userId}`}
                          onClick={() => toggleMemberSubteam(member, st.id)}
                        >
                          {st.name}
                        </button>
                      );
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

export default function TeamCalendarClient() {
  const [view, setView] = useState<SubteamCalendarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("calendar");
  const [filterSubteamId, setFilterSubteamId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFetchFailed(false);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId");
    try {
      const response = await fetch(`/api/team/calendar${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as SubteamCalendarView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the team calendar.");
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/team/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("Network error — changes were not saved.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const ready = view?.status === "ready" ? view : null;
  const filtered = useMemo(
    () => (ready ? filterEventsBySubteam(ready.events, filterSubteamId) : []),
    [ready, filterSubteamId],
  );
  const days = useMemo(() => groupEventsByDay(filtered), [filtered]);
  const upcoming = useMemo(() => upcomingEvents(filtered, new Date(), 6), [filtered]);

  if (fetchFailed || !view) {
    return (
      <main className="module-page tc-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Calendar</span>
            <h1>Team Calendar</h1>
          </div>
        </header>
        <div className="app-card tc-empty">
          {fetchFailed ? (
            <>
              <strong>Could not load the team calendar</strong>
              <p className="app-muted">{error || "Check your connection and try again."}</p>
              <button type="button" className="app-button secondary" onClick={() => void load()}>
                Retry
              </button>
            </>
          ) : (
            <p className="app-muted">Loading team calendar…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page tc-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Calendar</span>
            <h1>Team Calendar</h1>
            <p>Subteam calendars for practices, build sessions, and deadlines.</p>
          </div>
        </header>
        <div className="app-card tc-empty">
          <strong>Select a team workspace</strong>
          <p className="app-muted">{view.message}</p>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId!;
  const canManage = view.context.canManage;
  const teamLabel = view.context.teamNumber ? `Team ${view.context.teamNumber}` : view.context.orgName;

  return (
    <main className="module-page tc-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Calendar</span>
          <h1>Team Calendar</h1>
          <p>
            {teamLabel} — filter by subteam or view the combined schedule. Season milestones stay on{" "}
            <a href={withOrg("/calendar", orgId)}>Season Calendar</a>.
          </p>
        </div>
      </header>

      {error ? <p className="tc-error">{error}</p> : null}

      <div className="tc-tabs" role="tablist" aria-label="Calendar sections">
        <button type="button" role="tab" aria-selected={tab === "calendar"} className={tab === "calendar" ? "active" : ""} onClick={() => setTab("calendar")}>
          Calendar
        </button>
        {canManage ? (
          <button type="button" role="tab" aria-selected={tab === "subteams"} className={tab === "subteams" ? "active" : ""} onClick={() => setTab("subteams")}>
            Subteams
          </button>
        ) : null}
      </div>

      {tab === "subteams" && canManage ? (
        <SubteamsPanel orgId={orgId} subteams={view.subteams} members={view.members} busyKey={busyKey} run={run} />
      ) : (
        <>
          <div className="tc-filters" role="group" aria-label="Filter by subteam">
            <button
              type="button"
              className={filterSubteamId == null ? "tc-filter active" : "tc-filter"}
              style={filterSubteamId == null ? { background: "var(--app-accent)" } : undefined}
              onClick={() => setFilterSubteamId(null)}
            >
              Combined team
            </button>
            {view.subteams.map((st) => (
              <button
                key={st.id}
                type="button"
                className={filterSubteamId === st.id ? "tc-filter active" : "tc-filter"}
                style={filterSubteamId === st.id ? { background: st.color } : undefined}
                onClick={() => setFilterSubteamId(st.id)}
              >
                <i className="tc-dot" style={{ background: filterSubteamId === st.id ? "#fff" : st.color }} />
                {st.name}
              </button>
            ))}
            {view.mySubteamIds.length > 0 && filterSubteamId == null ? (
              <span className="tc-muted">You’re on {view.mySubteamIds.length} subteam{view.mySubteamIds.length === 1 ? "" : "s"}</span>
            ) : null}
          </div>

          {view.subteams.length === 0 ? (
            <div className="app-card tc-empty">
              <strong>No subteams yet</strong>
              <p className="app-muted">
                {canManage
                  ? "Create Mechanical, Electrical, Programming, or any group your team uses — then schedule on their calendars."
                  : "Ask an owner or admin to create subteams so the calendar can filter by group."}
              </p>
              {canManage ? (
                <button type="button" className="app-button" onClick={() => setTab("subteams")}>
                  Set up subteams
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="tc-layout">
            <section className="tc-panel">
              {days.length === 0 ? (
                <div className="tc-empty" style={{ padding: 8 }}>
                  <strong>No events in this view</strong>
                  <p className="tc-muted">Schedule a practice, build session, or deadline — or switch filters.</p>
                </div>
              ) : (
                days.map((bucket) => (
                  <div key={bucket.day} className="tc-day">
                    <h3>{bucket.label}</h3>
                    {bucket.items.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        orgId={orgId}
                        busy={busyKey != null}
                        canDelete={canManage || event.createdByName != null}
                        onDelete={() => {
                          if (confirm(`Remove “${event.title}” from the calendar?`)) {
                            void run({ action: "delete_event", orgId, id: event.id }, `del:${event.id}`);
                          }
                        }}
                      />
                    ))}
                  </div>
                ))
              )}
            </section>

            <aside className="tc-panel">
              <h2>Coming up</h2>
              {upcoming.length === 0 ? (
                <p className="tc-muted">Nothing upcoming in this filter.</p>
              ) : (
                <ul className="tc-upcoming">
                  {upcoming.map((event) => (
                    <li key={event.id}>
                      <strong>{event.title}</strong>
                      <span>
                        {fmtWhen(event.startsAt)}
                        {event.subteamName ? ` · ${event.subteamName}` : " · Whole team"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <CreateEventForm
                orgId={orgId}
                subteams={view.subteams}
                attendanceEvents={view.attendanceEvents}
                practiceSessions={view.practiceSessions}
                filterSubteamId={filterSubteamId}
                busy={busyKey != null}
                run={run}
              />

              <div className="tc-related">
                <a href={withOrg("/attendance", orgId)}>Attendance</a>
                <a href={withOrg("/practice", orgId)}>Practice Planner</a>
                <a href={withOrg("/calendar", orgId)}>Season milestones</a>
              </div>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
