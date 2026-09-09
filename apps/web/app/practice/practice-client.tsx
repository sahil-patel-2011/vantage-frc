"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TeamHubRelated } from "../../components/team-hub-related";
import { TeamOpsNav } from "../../components/team-ops-nav";
import { hubHref } from "../../lib/nav/hubs";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  actionBreakdown,
  sessionStats,
  SUGGESTED_ACTIONS,
  type DriverCycle,
  type DriverPracticeMember,
  type DriverPracticeView,
  type DriverSession,
  type LinkableAttendance,
  type LinkableBuildTask,
} from "../../lib/driver-practice";
import {
  PRACTICE_TEAM_RELATED_INCLUDE,
  attendanceRollCallHref,
  formatAttendanceOption,
  formatSessionEvidence,
  practiceNextActions,
} from "../../lib/practice/practice-related";
import "./practice.css";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type ReadyView = Extract<DriverPracticeView, { status: "ready" }>;

function fmtDate(iso: string): string {
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function fmtSeconds(value: number | null): string {
  return value == null ? "—" : `${value % 1 === 0 ? value : value.toFixed(2)}s`;
}

function driverLabel(session: DriverSession, membersById: Map<string, DriverPracticeMember>): string {
  return session.driverName ?? (session.driverUserId ? membersById.get(session.driverUserId)?.name ?? "Member" : "Unassigned");
}

function teamTab(tab: string, orgId: string) {
  return hubHref("/team", tab, orgId);
}

function PracticeNextActions({ actions }: { actions: ReturnType<typeof practiceNextActions> }) {
  if (actions.length === 0) return null;
  return (
    <section className="practice-next-actions" aria-label="Next actions">
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Stopwatch({ onStop, disabled }: { onStop: (seconds: number) => void; disabled?: boolean }) {
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);

  const tick = useCallback(() => {
    setElapsed((Date.now() - startRef.current) / 1000);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const start = () => {
    startRef.current = Date.now();
    setElapsed(0);
    setRunning(true);
    rafRef.current = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    setRunning(false);
    onStop(Math.round(((Date.now() - startRef.current) / 1000) * 100) / 100);
  };

  return (
    <div className={running ? "practice-stopwatch running" : "practice-stopwatch"}>
      <b>{elapsed.toFixed(1)}s</b>
      {running ? (
        <button type="button" className="app-button sm" onClick={stop}>Stop</button>
      ) : (
        <button type="button" className="app-button secondary sm" disabled={disabled} onClick={start}>Time it</button>
      )}
    </div>
  );
}

function CycleLogger({
  sessionId, orgId, busy, run,
}: {
  sessionId: string; orgId: string; busy: boolean;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const [cycleAction, setCycleAction] = useState(SUGGESTED_ACTIONS[0] as string);
  const [seconds, setSeconds] = useState("");
  const [success, setSuccess] = useState(true);
  const [note, setNote] = useState("");

  return (
    <form
      className="practice-logger"
      onSubmit={(event) => {
        event.preventDefault();
        if (!cycleAction.trim()) return;
        void run({
          action: "add_cycle", orgId, sessionId,
          cycleAction: cycleAction.trim(),
          seconds: seconds === "" ? null : Number(seconds),
          success, note: note.trim(),
        }, `log:${sessionId}`).then(() => {
          setSeconds("");
          setNote("");
          setSuccess(true);
        });
      }}
    >
      <input list="practice-actions" placeholder="Cycle / action" value={cycleAction} disabled={busy} onChange={(e) => setCycleAction(e.target.value)} />
      <datalist id="practice-actions">{SUGGESTED_ACTIONS.map((value) => <option key={value} value={value} />)}</datalist>
      <input type="number" step="any" min={0} placeholder="secs" className="practice-secs" value={seconds} disabled={busy} onChange={(e) => setSeconds(e.target.value)} />
      <Stopwatch disabled={busy} onStop={(value) => setSeconds(String(value))} />
      <button type="button" className={success ? "practice-toggle ok" : "practice-toggle miss"} disabled={busy} aria-pressed={success} onClick={() => setSuccess((v) => !v)}>
        {success ? "Made" : "Miss"}
      </button>
      <input placeholder="Note" value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
      <button type="submit" className="app-button" disabled={busy || !cycleAction.trim()}>Log rep</button>
    </form>
  );
}

function CycleList({
  cycles, orgId, busy, run,
}: {
  cycles: DriverCycle[]; orgId: string; busy: boolean;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  if (cycles.length === 0) return <p className="practice-muted">No reps yet — log the first cycle above. Success rate stays blank until then.</p>;
  return (
    <ul className="practice-cycles">
      {[...cycles].reverse().map((cycle) => (
        <li key={cycle.id} className={cycle.success ? undefined : "miss"}>
          <span className="practice-cycle-idx">#{cycle.repIndex + 1}</span>
          <span className="practice-cycle-action">
            {cycle.action}
            {cycle.note ? <small className="practice-muted"> · {cycle.note}</small> : null}
          </span>
          <b className="practice-cycle-secs">{fmtSeconds(cycle.seconds)}</b>
          <button type="button" className={cycle.success ? "practice-toggle ok sm" : "practice-toggle miss sm"} disabled={busy} onClick={() => void run({ action: "update_cycle", orgId, id: cycle.id, success: !cycle.success }, `cycle:${cycle.id}`)}>
            {cycle.success ? "✓" : "✗"}
          </button>
          <button type="button" className="practice-text-btn danger" aria-label="Delete rep" disabled={busy} onClick={() => void run({ action: "delete_cycle", orgId, id: cycle.id }, `cycle:${cycle.id}`)}>✕</button>
        </li>
      ))}
    </ul>
  );
}

function SessionDetail({
  session, membersById, orgId, attendanceEvents, buildTasks, busyKey, run,
}: {
  session: DriverSession;
  membersById: Map<string, DriverPracticeMember>;
  orgId: string;
  attendanceEvents: LinkableAttendance[];
  buildTasks: LinkableBuildTask[];
  busyKey: string | null;
  run: (body: ActionBody, key: string) => Promise<void>;
}) {
  const stats = useMemo(() => sessionStats(session.cycles), [session.cycles]);
  const breakdown = useMemo(() => actionBreakdown(session.cycles), [session.cycles]);
  const busy = busyKey != null;
  const linkedAttendance = session.attendanceEventId
    ? attendanceEvents.find((event) => event.id === session.attendanceEventId)
    : undefined;
  const rollOccurredOn = session.attendanceOccurredOn ?? linkedAttendance?.occurredOn ?? null;
  const rollHref = session.attendanceEventId
    ? attendanceRollCallHref(orgId, { eventId: session.attendanceEventId, occurredOn: rollOccurredOn })
    : teamTab("attendance", orgId);

  return (
    <section className="practice-panel practice-detail">
      <header className="practice-detail-head">
        <div>
          <h2>{session.title}</h2>
          <p>
            {fmtDate(session.sessionDate)} · Driver: {driverLabel(session, membersById)}
            {session.location ? ` · ${session.location}` : ""}
          </p>
          {session.goal ? <p className="practice-goal">{session.goal}</p> : (
            <p className="practice-muted">No session goal yet — add one so the drive team knows the target for the day.</p>
          )}
        </div>
        <button
          type="button"
          className="practice-text-btn danger"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete "${session.title}" and all its reps?`)) {
              void run({ action: "delete_session", orgId, id: session.id }, "delete");
            }
          }}
        >
          Delete session
        </button>
      </header>

      <div className="practice-links-row">
        <label className="practice-link-card">
          <span>Attendance roll call</span>
          {attendanceEvents.length > 0 ? (
            <select
              value={session.attendanceEventId ?? ""}
              disabled={busy}
              onChange={(e) => void run({ action: "update_session", orgId, id: session.id, attendanceEventId: e.target.value || null }, `link:${session.id}`)}
            >
              <option value="">Not linked</option>
              {attendanceEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {formatAttendanceOption(event, fmtDate)}
                </option>
              ))}
            </select>
          ) : (
            <p className="practice-muted">No attendance events yet — create one with an occurred_on date.</p>
          )}
          {session.attendanceEventId ? (
            <a href={rollHref}>
              Open roll call
              {rollOccurredOn ? ` · ${fmtDate(rollOccurredOn)}` : ""} →
            </a>
          ) : (
            <a href={teamTab("attendance", orgId)}>Open Attendance →</a>
          )}
        </label>
        <label className="practice-link-card">
          <span>Build task</span>
          {buildTasks.length > 0 ? (
            <select
              value={session.buildTaskId ?? ""}
              disabled={busy}
              onChange={(e) => void run({ action: "update_session", orgId, id: session.id, buildTaskId: e.target.value || null }, `link:${session.id}`)}
            >
              <option value="">Not linked</option>
              {buildTasks.map((task) => (
                <option key={task.id} value={task.id}>{task.title} · {task.subsystem}</option>
              ))}
            </select>
          ) : (
            <p className="practice-muted">No open build tasks — optional shop-work link.</p>
          )}
          {session.buildTaskId ? (
            <a href={teamTab("todos", orgId)}>Open task board →</a>
          ) : (
            <a href={teamTab("batteries", orgId)}>Batteries for practice packs →</a>
          )}
        </label>
      </div>

      <div className="practice-stats">
        <div className="practice-stat"><strong>{stats.reps}</strong><span>reps</span></div>
        <div className="practice-stat"><strong>{stats.successRate == null ? "—" : `${stats.successRate}%`}</strong><span>made</span></div>
        <div className="practice-stat"><strong>{fmtSeconds(stats.avgSeconds)}</strong><span>avg cycle</span></div>
        <div className="practice-stat"><strong>{fmtSeconds(stats.bestSeconds)}</strong><span>best</span></div>
      </div>

      <CycleLogger sessionId={session.id} orgId={orgId} busy={busyKey === `log:${session.id}`} run={run} />

      {breakdown.length > 1 ? (
        <div className="practice-breakdown">
          <h3>By action</h3>
          <ul>
            {breakdown.map((row) => (
              <li key={row.action}>
                <span>{row.action}</span>
                <b>{row.reps} reps</b>
                <b>{row.successRate == null ? "—" : `${row.successRate}%`}</b>
                <b>{fmtSeconds(row.avgSeconds)}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <CycleList cycles={session.cycles} orgId={orgId} busy={busy} run={run} />
    </section>
  );
}

function NewSessionForm({
  orgId, members, attendanceEvents, buildTasks, busy, onCreate, onClose,
}: {
  orgId: string;
  members: ReadyView["members"];
  attendanceEvents: LinkableAttendance[];
  buildTasks: LinkableBuildTask[];
  busy: boolean;
  onCreate: (body: ActionBody) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState("");
  const [driverUserId, setDriverUserId] = useState("");
  const [location, setLocation] = useState("");
  const [goal, setGoal] = useState("");
  const [attendanceEventId, setAttendanceEventId] = useState("");
  const [buildTaskId, setBuildTaskId] = useState("");

  return (
    <form
      className="practice-panel practice-new"
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        onCreate({
          action: "create_session", orgId, title: title.trim(),
          driverUserId: driverUserId || null, location: location.trim(), goal: goal.trim(),
          attendanceEventId: attendanceEventId || null, buildTaskId: buildTaskId || null,
        });
      }}
    >
      <header>
        <h2>New practice session</h2>
        <button type="button" className="practice-text-btn" onClick={onClose}>Cancel</button>
      </header>
      <div className="practice-new-grid">
        <label className="practice-field grow">
          <span>Title</span>
          <input value={title} disabled={busy} placeholder="e.g. Saturday field practice" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="practice-field">
          <span>Driver</span>
          <select value={driverUserId} disabled={busy} onChange={(e) => setDriverUserId(e.target.value)}>
            <option value="">Unassigned</option>
            {members.map((member) => <option key={member.userId} value={member.userId}>{member.name ?? "Member"}</option>)}
          </select>
        </label>
        <label className="practice-field">
          <span>Location</span>
          <input value={location} disabled={busy} placeholder="Shop / field" onChange={(e) => setLocation(e.target.value)} />
        </label>
        <label className="practice-field grow">
          <span>Session goal</span>
          <input value={goal} disabled={busy} placeholder="e.g. Sub-6s scoring cycles" onChange={(e) => setGoal(e.target.value)} />
        </label>
        {attendanceEvents.length > 0 ? (
          <label className="practice-field">
            <span>Link attendance (occurred_on)</span>
            <select value={attendanceEventId} disabled={busy} onChange={(e) => setAttendanceEventId(e.target.value)}>
              <option value="">None</option>
              {attendanceEvents.map((event) => (
                <option key={event.id} value={event.id}>
                  {formatAttendanceOption(event, fmtDate)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {buildTasks.length > 0 ? (
          <label className="practice-field">
            <span>Link build task</span>
            <select value={buildTaskId} disabled={busy} onChange={(e) => setBuildTaskId(e.target.value)}>
              <option value="">None</option>
              {buildTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            </select>
          </label>
        ) : null}
      </div>
      <button type="submit" className="app-button" disabled={busy || !title.trim()}>{busy ? "Creating…" : "Start session"}</button>
    </form>
  );
}

export default function PracticeClient({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<DriverPracticeView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    try {
      const response = await fetch(`/api/practice${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as DriverPracticeView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load practice planner.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
    } catch {
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = useCallback(async (body: ActionBody, key: string) => {
    setBusyKey(key);
    setError("");
    try {
      const response = await fetch("/api/practice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as { error?: string; id?: string };
      if (!response.ok) {
        setError(data.error ?? "Action failed.");
        return;
      }
      if (body.action === "create_session" && data.id) setSelectedId(data.id);
      if (body.action === "create_session") setShowNew(false);
      if (body.action === "delete_session") setSelectedId(null);
      await load();
    } catch {
      setError("Network error — changes were not saved.");
    } finally {
      setBusyKey(null);
    }
  }, [load]);

  if (fetchFailed || !view) {
    return (
      <main className="practice-page">
        <TeamOpsNav active="practice" />
        <header className="practice-hero">
          <div>
            <p className="practice-kicker">Team / Practice</p>
            <h1>Practice</h1>
            <p>Sessions, goals, and cycle times for the drive team.</p>
          </div>
        </header>
        <div className="practice-panel practice-empty">
          {fetchFailed ? (
            (() => {
              const copy = loadFailureCopy(
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
                  message: error || "Check your connection and try again.",
                },
              );
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="practice-muted">{copy.description}</p>
                  {copy.primary ? (
                    <a className="app-button" href={copy.primary.href}>
                      {copy.primary.label}
                    </a>
                  ) : null}
                  {copy.showRetry ? (
                    <button type="button" className="app-button" onClick={() => void load()}>
                      Retry
                    </button>
                  ) : null}
                </>
              );
            })()
          ) : (
            <p className="practice-muted">Loading practice planner…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    const setupActions = practiceNextActions({ sessions: [], attendanceEventCount: 0 });
    return (
      <main className="practice-page">
        <TeamOpsNav active="practice" />
        <header className="practice-hero">
          <div>
            <p className="practice-kicker">Team / Practice</p>
            <h1>Practice</h1>
            <p>Log drive-team sessions, set goals, and track cycle times against real attendance and build work.</p>
          </div>
        </header>
        <div className="practice-panel practice-empty">
          <strong>Select a team workspace</strong>
          <p className="practice-muted">{view.message}</p>
          <a className="app-button" href="/workspace">Choose workspace</a>
        </div>
        <PracticeNextActions actions={setupActions} />
      </main>
    );
  }

  const { context, sessions, members, attendanceEvents, buildTasks } = view;
  const orgId = context.orgId ?? "";
  const membersById = new Map(members.map((member) => [member.userId, member]));
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null;
  const overall = sessionStats(sessions.flatMap((session) => session.cycles));
  const withGoals = sessions.filter((session) => session.goal.trim()).length;
  const withRollCalls = sessions.filter((session) => session.attendanceEventId).length;
  const nextActions = practiceNextActions({
    orgId,
    sessions,
    attendanceEventCount: attendanceEvents.length,
  });

  return (
    <main className={`practice-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <>
          <TeamOpsNav orgId={orgId} active="practice" />
          <TeamHubRelated orgId={orgId} active="practice" include={[...PRACTICE_TEAM_RELATED_INCLUDE]} />
        </>
      ) : null}
      <header className="practice-hero">
        <div>
          {!embedded ? (
            <p className="practice-kicker">Team / Practice{context.teamNumber ? ` · ${context.teamNumber}` : ""}</p>
          ) : null}
          {!embedded ? <h1>Practice</h1> : null}
          <p>
            Schedule drive sessions, write the goal for the day, time every cycle, and link roll calls by occurred_on
            for {context.orgName ?? "your team"}
          </p>
          {!embedded ? (
            <div className="practice-hero-links">
              <a href={teamTab("calendar", orgId)}>Calendar</a>
              <a href={teamTab("attendance", orgId)}>Attendance</a>
              <a href={teamTab("batteries", orgId)}>Batteries</a>
              <a href={teamTab("todos", orgId)}>Todos</a>
              <a href={teamTab("messages", orgId)}>Messages</a>
            </div>
          ) : null}
        </div>
        <div className="practice-hero-score">
          <strong>{overall.reps > 0 ? overall.reps : "—"}</strong>
          <span>{overall.reps > 0 ? "reps logged this season" : "no reps logged yet"}</span>
          <button type="button" onClick={() => setShowNew((value) => !value)}>{showNew ? "Close form" : "New session"}</button>
        </div>
      </header>

      {error ? <p className="practice-alert error" role="alert">{error}</p> : null}

      <PracticeNextActions actions={nextActions} />

      <section className="practice-kpis">
        <article><span>Sessions</span><strong>{sessions.length}</strong></article>
        <article><span>With goals</span><strong>{withGoals}</strong></article>
        <article><span>Roll calls linked</span><strong>{withRollCalls}</strong></article>
        <article>
          <span>Made / avg</span>
          <strong>
            {overall.successRate == null && overall.avgSeconds == null
              ? "—"
              : `${overall.successRate == null ? "—" : `${overall.successRate}%`} · ${fmtSeconds(overall.avgSeconds)}`}
          </strong>
        </article>
      </section>

      {showNew ? (
        <NewSessionForm
          orgId={orgId}
          members={members}
          attendanceEvents={attendanceEvents}
          buildTasks={buildTasks}
          busy={busyKey === "create-session"}
          onCreate={(body) => void run(body, "create-session")}
          onClose={() => setShowNew(false)}
        />
      ) : null}

      {sessions.length === 0 ? (
        <div className="practice-panel practice-empty center">
          <strong>No practice sessions yet</strong>
          <p className="practice-muted">
            Start a session with a clear goal, link an attendance roll call by occurred_on when ready, then log each
            scoring rep with the stopwatch. Totals stay empty until you log real work.
          </p>
          <div className="practice-empty-actions">
            <button type="button" className="app-button" onClick={() => setShowNew(true)}>Start your first session</button>
            <a className="app-button secondary" href={teamTab("calendar", orgId)}>Open Calendar</a>
            <a className="app-button secondary" href={teamTab("attendance", orgId)}>Open Attendance</a>
            <a className="app-button secondary" href={teamTab("batteries", orgId)}>Open Batteries</a>
          </div>
        </div>
      ) : (
        <div className="practice-layout">
          <aside className="practice-list" aria-label="Practice sessions">
            <header className="practice-list-head">
              <h2>Sessions</h2>
              <p className="practice-muted">{sessions.length} scheduled · evidence from logged reps only</p>
            </header>
            {sessions.map((session) => {
              const isActive = session.id === selected?.id;
              return (
                <button
                  key={session.id}
                  type="button"
                  className={isActive ? "practice-list-item active" : "practice-list-item"}
                  onClick={() => setSelectedId(session.id)}
                >
                  <div className="practice-list-top">
                    <strong>{session.title}</strong>
                    <span>{fmtDate(session.sessionDate)}</span>
                  </div>
                  <div className="practice-list-sub">
                    <span>{driverLabel(session, membersById)}</span>
                  </div>
                  <p className="practice-list-evidence">{formatSessionEvidence(session)}</p>
                  {(session.attendanceEventTitle || session.buildTaskTitle || session.attendanceOccurredOn) && (
                    <div className="practice-list-links">
                      {session.attendanceEventId ? (
                        <span className="practice-chip">
                          Roll call
                          {session.attendanceOccurredOn ? ` · ${fmtDate(session.attendanceOccurredOn)}` : ""}
                        </span>
                      ) : null}
                      {session.buildTaskTitle ? <span className="practice-chip">Task</span> : null}
                    </div>
                  )}
                </button>
              );
            })}
          </aside>
          {selected ? (
            <SessionDetail
              key={selected.id}
              session={selected}
              membersById={membersById}
              orgId={orgId}
              attendanceEvents={attendanceEvents}
              buildTasks={buildTasks}
              busyKey={busyKey}
              run={run}
            />
          ) : null}
        </div>
      )}
    </main>
  );
}
