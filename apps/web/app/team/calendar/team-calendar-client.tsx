"use client";

import "./team-calendar.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../../components/ui";
import { OfflineBanner } from "../../../components/offline-banner";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import {
  dayCountLabel,
  monthCellLabel,
  monthEventCountLabel,
  monthEventPeek,
} from "../../../lib/calendar/calendar-related";
import {
  filterTasksBySubteam,
  taskSummary,
  tasksByDay,
} from "../../../lib/calendar/tasks-on-calendar";
import { pickToDraft, type SchedulerPick } from "../../../lib/calendar-ai/pick";
import {
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
  useOnline,
} from "../../../lib/offline";
import {
  buildDayCells,
  buildMonthCells,
  buildWeekCells,
  defaultQuickAddStartsAt,
  filterEventsBySubteam,
  formatAnchorLabel,
  groupEventsByDay,
  isReadonlyCalendarEvent,
  localDayKey,
  overlayItemsForDay,
  parseLocalDay,
  shiftAnchor,
  upcomingEvents,
  type CalendarEvent,
  type CalendarFeedScope,
  type CalendarViewMode,
  type RsvpResponse,
  type SubteamCalendarView,
} from "../../../lib/subteam-calendar";
import { AiScheduler } from "./ai-scheduler";
import {
  CreateEventForm,
  EventCard,
  QuickAddForm,
} from "./calendar-event-editors";
import {
  WEEKDAYS,
  dayNum,
  formatDayLabelLocal,
  fmtWhen,
  isSeriesEvent,
  type ActionBody,
  type EventPrefill,
  type RecurringEvent,
  type Tab,
} from "./calendar-model";
import { DutiesPanel, SubteamsPanel, TripPanel } from "./calendar-side-panels";
import { CalendarSyncPanel } from "./calendar-sync-panel";
import { GitHubCalendarHint } from "./github-calendar-hint";
import { DayTasks } from "./task-chip";
import { TimedCalendarGrid } from "./timed-calendar-grid";

function isSubteamCalendarView(value: unknown): value is SubteamCalendarView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

async function persistTeamCalendarSnapshot(orgHint: string, data: SubteamCalendarView): Promise<void> {
  const cacheOrg = data.context.orgId?.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("team-calendar", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("team-calendar", "_", data);
  } catch {
    // Live team calendar already painted; IndexedDB is best-effort.
  }
}

export default function TeamCalendarClient({ embedded = false }: { embedded?: boolean } = {}) {
  const online = useOnline();
  const [view, setView] = useState<SubteamCalendarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** Event currently asking "this / this and following / all events". */
  const [scopeEventId, setScopeEventId] = useState<string | null>(null);
  /** Event whose inline editor is open. */
  const [editEventId, setEditEventId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("calendar");
  const [filterSubteamId, setFilterSubteamId] = useState<string | null>(null);
  const [mode, setMode] = useState<CalendarViewMode>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [quickDay, setQuickDay] = useState<string | null>(null);
  const [quickHour, setQuickHour] = useState<number | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [syncScope, setSyncScope] = useState<CalendarFeedScope>("personal");
  const [syncSubteamId, setSyncSubteamId] = useState<string | null>(null);
  const [highlightDutyId, setHighlightDutyId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<EventPrefill | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const viewRef = useRef<SubteamCalendarView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId")?.trim() ?? "";
    const dutyId = params.get("dutyId");
    if (dutyId) {
      setHighlightDutyId(dutyId);
      setTab("duties");
    }
    if (params.get("tab") === "trip") setTab("trip");
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<SubteamCalendarView>("team-calendar", urlOrg || "_");
      if (!viewRef.current && cached?.data && isSubteamCalendarView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    try {
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      query.set("scope", syncScope);
      if (syncScope === "subteam" && syncSubteamId) query.set("subteamId", syncSubteamId);
      const response = await fetch(`/api/team/calendar?${query.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as SubteamCalendarView | { error?: string };
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setError("error" in data && data.error ? data.error : "Could not load the team calendar.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      if (!response.ok || !isSubteamCalendarView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Calendar. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setError("error" in data && data.error ? data.error : "Could not load the team calendar.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setErrorStatus(null);
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistTeamCalendarSnapshot(urlOrg, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Calendar. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, [syncScope, syncSubteamId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (isBrowserOffline()) {
        if (body.action === "set_rsvp" && body.orgId) {
          await queueProductWrite({
            feature: "calendar_rsvp",
            orgId: String(body.orgId),
            payload: body,
          });
          setError(QUEUED_ON_DEVICE);
          return true;
        }
        setError("You're offline — that change needs a connection.");
        return false;
      }
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/team/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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

  const runDuty = useCallback(
    async (body: Record<string, unknown>, key: string) => {
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/duties", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Duty action failed.");
          return false;
        }
        await load();
        return true;
      } catch {
        setError("Network error — duty was not saved.");
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  const ready = view?.status === "ready" ? view : null;
  const githubItems = ready?.githubCalendar?.items ?? [];
  const filtered = useMemo(
    () => (ready ? filterEventsBySubteam([...ready.events, ...(ready.tbaMatches ?? [])], filterSubteamId) : []),
    [ready, filterSubteamId],
  );
  const days = useMemo(() => groupEventsByDay(filtered), [filtered]);
  // Tasks obey the same subteam rule as events: filtering to Mechanical still
  // shows whole-team work, because that work is Mechanical's too.
  const tasks = useMemo(
    () => filterTasksBySubteam(ready?.tasks ?? [], filterSubteamId),
    [ready, filterSubteamId],
  );
  const taskDays = useMemo(() => tasksByDay(tasks), [tasks]);
  const taskDayKeys = useMemo(() => [...taskDays.keys()], [taskDays]);
  const todayKey = useMemo(() => localDayKey(new Date()), []);
  const taskCounts = useMemo(() => taskSummary(tasks, todayKey), [tasks, todayKey]);

  const listDays = useMemo(() => {
    const byDay = new Map(days.map((bucket) => [bucket.day, bucket]));
    const addEmptyDay = (day: string) => {
      if (byDay.has(day)) return;
      byDay.set(day, { day, label: formatDayLabelLocal(day), items: [] as CalendarEvent[] });
    };
    for (const item of githubItems) addEmptyDay(item.dueOn);
    // A day whose only entry is a task due still has to appear, or the list
    // silently drops the deadline.
    for (const day of taskDayKeys) addEmptyDay(day);
    const buckets = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
    if (!quickDay) return buckets;
    const focused = buckets.filter((bucket) => bucket.day === quickDay);
    const rest = buckets.filter((bucket) => bucket.day !== quickDay);
    if (focused.length === 0) {
      return [
        {
          day: quickDay,
          label: formatDayLabelLocal(quickDay),
          items: [] as CalendarEvent[],
        },
        ...rest,
      ];
    }
    return [...focused, ...rest];
  }, [days, githubItems, taskDayKeys, quickDay]);
  const upcoming = useMemo(() => upcomingEvents(filtered, new Date(), 6), [filtered]);
  const weekCells = useMemo(() => buildWeekCells(anchor, filtered), [anchor, filtered]);
  const dayCells = useMemo(() => buildDayCells(anchor, filtered), [anchor, filtered]);
  const monthCells = useMemo(() => buildMonthCells(anchor, filtered), [anchor, filtered]);
  const timedCells = mode === "day" ? dayCells : weekCells;
  const selectedEvent = useMemo(
    () => (selectedEventId ? filtered.find((event) => event.id === selectedEventId) ?? null : null),
    [filtered, selectedEventId],
  );
  const quickStartsAt = useMemo(
    () => defaultQuickAddStartsAt(quickDay, new Date(), quickHour),
    [quickDay, quickHour],
  );

  if (!view) {
    return (
      <main className={`module-page tc-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <header className="app-page-header">
            <div>
              <span className="breadcrumbs">Team / Calendar</span>
              <h1>Calendar</h1>
            </div>
          </header>
        ) : null}
        <OfflineBanner feature="Calendar" fromCache={Boolean(view) && fromCache} cachedAt={cachedAt} />
        <div className="app-card tc-empty">
          {fetchFailed ? (
            (() => {
              const kind = classifyLoadFailure({ status: errorStatus, message: error, online });
              const copy = loadFailureCopy(kind, {
                nextPath:
                  typeof window === "undefined"
                    ? null
                    : `${window.location.pathname}${window.location.search}`,
                message:
                  error || "No cached calendar on this device yet. Check your connection and try again.",
              });
              return (
                <>
                  <strong>{copy.title}</strong>
                  <p className="app-muted">{copy.description}</p>
                  <div className="tc-guide-actions">
                    {copy.primary ? (
                      <Button as="a" variant="primary" href={copy.primary.href}>
                        {copy.primary.label}
                      </Button>
                    ) : null}
                    {copy.showRetry ? (
                      <Button variant="secondary" type="button" onClick={() => void load()}>
                        Retry
                      </Button>
                    ) : null}
                  </div>
                </>
              );
            })()
          ) : (
            <p className="app-muted">Loading team calendar…</p>
          )}
        </div>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className={`module-page tc-page${embedded ? " is-embedded" : ""}`}>
        {!embedded ? (
          <header className="app-page-header">
            <div>
              <span className="breadcrumbs">Team / Calendar</span>
              <h1>Calendar</h1>
            </div>
          </header>
        ) : null}
        <OfflineBanner feature="Calendar" fromCache={fromCache} cachedAt={cachedAt} />
        <div className="app-card tc-empty">
          <strong>Choose your team</strong>
          <p className="app-muted">{view.message}</p>
          <div className="tc-guide-actions">
            <Button as="a" variant="primary" href="/workspace">
              Choose your team
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const orgId = view.context.orgId!;
  const canManage = view.context.canManage;
  const busy = busyKey != null;
  const showDuties = (view.duties?.length ?? 0) > 0 || canManage;
  const showTrip = (view.travelLegs?.length ?? 0) > 0;

  const setRsvp = (eventId: string, response: RsvpResponse | null) => {
    void run({ action: "set_rsvp", orgId, id: eventId, response }, `rsvp:${eventId}`);
  };

  // Creating a task goes to /api/todos, not to the calendar's own action set.
  // One writer for tasks means RLS, notifications and the /todos page all keep
  // agreeing with each other, instead of a second copy drifting from the first.
  const addTask = async (input: { title: string; dueOn: string; subteamId: string | null }) => {
    try {
      const response = await fetch("/api/todos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create-todo", orgId, ...input }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not add that task.");
        return false;
      }
      setError("");
      await load();
      return true;
    } catch {
      setError("Could not reach the server.");
      return false;
    }
  };

  // Taking a suggested slot fills in the full event form and opens it. It does
  // not create anything: the person still reads the draft and presses Add.
  const usePick = (pick: SchedulerPick) => {
    setPrefill({
      nonce: Date.now(),
      ...pickToDraft(pick, view.subteams.map((st) => st.id)),
    });
    setDetailsOpen(true);
    // The form is below the fold on a laptop; a prefill nobody sees reads as a
    // dead button.
    requestAnimationFrame(() => {
      detailsRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  };

  const renderEventCard = (rawEvent: CalendarEvent) => {
    const event = rawEvent as RecurringEvent;
    const repeats = isSeriesEvent(event);
    return (
      <EventCard
        key={event.id}
        event={event}
        busy={busy}
        canDelete={canManage && !isReadonlyCalendarEvent(event)}
        scopePrompt={scopeEventId === event.id}
        onScopePick={(scope) => {
          setScopeEventId(null);
          void run(
            { action: "delete_occurrence", orgId, id: event.id, scope },
            `del:${event.id}`,
          );
        }}
        onCancelScope={() => setScopeEventId(null)}
        canEdit={canManage && !isReadonlyCalendarEvent(event)}
        editing={editEventId === event.id}
        onStartEdit={() => {
          setScopeEventId(null);
          setEditEventId(event.id);
        }}
        onCancelEdit={() => setEditEventId(null)}
        onSaveEdit={(patch, scope) => {
          setEditEventId(null);
          void run(
            { action: "update_occurrence", orgId, id: event.id, scope, patch },
            `edit:${event.id}`,
          );
        }}
        onDelete={() => {
          // A repeating meeting needs the this / following / all choice before
          // anything is removed; a one-off keeps the plain confirm.
          if (repeats) {
            setScopeEventId(event.id);
            return;
          }
          if (confirm(`Remove “${event.title}” from the calendar?`)) {
            void run({ action: "delete_event", orgId, id: event.id }, `del:${event.id}`);
          }
        }}
        onRsvp={(response) => setRsvp(event.id, response)}
      />
    );
  };

  return (
    <main className={`module-page tc-page${embedded ? " is-embedded" : ""}`}>
      {!embedded ? (
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Team / Calendar</span>
            <h1>Calendar</h1>
          </div>
        </header>
      ) : null}
      <OfflineBanner feature="Calendar" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? <p className="tc-error">{error}</p> : null}

      {tab !== "calendar" ? (
        <button type="button" className="tc-back" onClick={() => setTab("calendar")}>
          ← Calendar
        </button>
      ) : null}

      {tab === "duties" ? (
        <DutiesPanel
          orgId={orgId}
          duties={view.duties ?? []}
          subteams={view.subteams}
          members={view.members}
          mySubteamIds={view.mySubteamIds}
          canManage={canManage}
          busyKey={busyKey}
          highlightId={highlightDutyId}
          initialStartsAt={quickStartsAt}
          onMutate={runDuty}
        />
      ) : tab === "trip" ? (
        <TripPanel orgId={orgId} travelLegs={view.travelLegs ?? []} mySubteamIds={view.mySubteamIds} />
      ) : tab === "subteams" && canManage ? (
        <SubteamsPanel orgId={orgId} subteams={view.subteams} members={view.members} busyKey={busyKey} run={run} />
      ) : tab === "sync" ? (
        <CalendarSyncPanel
          orgId={orgId}
          subteams={view.subteams}
          feedToken={view.calendarFeed?.token ?? null}
          scope={syncScope}
          subteamId={syncSubteamId ?? ""}
          github={view.githubCalendar}
          onScopeChange={(next) => {
            setSyncScope(next);
            if (next !== "subteam") setSyncSubteamId(null);
          }}
          onSubteamChange={(next) => setSyncSubteamId(next || null)}
          busyKey={busyKey}
          run={run}
        />
      ) : (
        <>
          {view.subteams.length > 0 ? (
            <label className="tc-filter-select">
              Calendar
              <select
                value={filterSubteamId ?? ""}
                aria-label="Filter by subteam"
                onChange={(event) => setFilterSubteamId(event.target.value || null)}
              >
                <option value="">Whole team</option>
                {view.subteams.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <GitHubCalendarHint overlay={view.githubCalendar} orgId={orgId} />

          <div className="tc-toolbar">
            <div className="tc-mode" role="group" aria-label="Calendar view">
              {(["day", "week", "month", "agenda"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={mode === value ? "active" : undefined}
                  onClick={() => setMode(value)}
                >
                  {value === "agenda" ? "List" : value === "week" ? "Week" : value === "month" ? "Month" : "Day"}
                </button>
              ))}
            </div>
            {mode !== "agenda" ? (
              <div className="tc-nav-range">
                <button type="button" className="tc-icon-btn" aria-label="Previous" onClick={() => setAnchor((d) => shiftAnchor(d, mode, -1))}>
                  ‹
                </button>
                <strong>{formatAnchorLabel(anchor, mode)}</strong>
                <button type="button" className="tc-icon-btn" aria-label="Next" onClick={() => setAnchor((d) => shiftAnchor(d, mode, 1))}>
                  ›
                </button>
                <button type="button" className="tc-text-link" onClick={() => setAnchor(new Date())}>
                  Today
                </button>
              </div>
            ) : quickDay ? (
              <div className="tc-nav-range">
                <strong>List · {formatDayLabelLocal(quickDay)}</strong>
                <button type="button" className="tc-text-link" onClick={() => setQuickDay(null)}>
                  Clear day focus
                </button>
              </div>
            ) : (
              <p className="tc-muted tc-list-hint">By day.</p>
            )}
            <div className="tc-toolbar-links">
              {taskCounts.open > 0 ? (
                <a className="tc-task-summary" href="/todos">
                  {taskCounts.overdue > 0 ? (
                    <strong className="is-late">
                      {taskCounts.overdue} overdue
                    </strong>
                  ) : null}
                  {taskCounts.dueToday > 0 ? <strong>{taskCounts.dueToday} due today</strong> : null}
                  <span>
                    {taskCounts.open} task{taskCounts.open === 1 ? "" : "s"} with a due date
                  </span>
                </a>
              ) : null}
              <button type="button" className="tc-text-link" onClick={() => setTab("sync")}>
                Phone calendar
              </button>
              {showDuties ? (
                <button type="button" className="tc-text-link" onClick={() => setTab("duties")}>
                  Duties
                </button>
              ) : null}
              {showTrip ? (
                <button type="button" className="tc-text-link" onClick={() => setTab("trip")}>
                  Trip
                </button>
              ) : null}
              {canManage ? (
                <button type="button" className="tc-text-link" onClick={() => setTab("subteams")}>
                  Subteams
                </button>
              ) : null}
            </div>
          </div>

          <div className="tc-layout">
            <section className="tc-panel tc-main">
              {mode === "agenda" ? (
                listDays.length === 0 ? (
                  <div className="tc-empty tc-list-empty">
                    <strong>Nothing scheduled</strong>
                    <p className="tc-muted">Click a time on the week grid to add one.</p>
                    <div className="tc-guide-actions">
                      <Button variant="primary" type="button" onClick={() => document.getElementById("tc-quick-add")?.scrollIntoView({ behavior: "smooth", block: "start" }) }>
                        Add event
                      </Button>
                    </div>
                  </div>
                ) : (
                  listDays.map((bucket) => (
                    <div
                      key={bucket.day}
                      className={["tc-day", quickDay === bucket.day ? "focused" : ""].filter(Boolean).join(" ")}
                      id={quickDay === bucket.day ? "tc-list-focus" : undefined}
                    >
                      <h3>
                        {bucket.label}
                        <span className="tc-day-count">
                          {dayCountLabel(bucket.items.length, taskDays.get(bucket.day)?.length ?? 0)}
                        </span>
                      </h3>
                      {overlayItemsForDay(githubItems, bucket.day).map((item) => (
                        <a
                          key={item.id}
                          className="tc-github-chip"
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          GitHub · {item.title}
                        </a>
                      ))}
                      {(taskDays.get(bucket.day)?.length ?? 0) > 0 ? (
                        <div className="tc-task-row">
                          <DayTasks
                            tasks={taskDays.get(bucket.day) ?? []}
                            today={todayKey}
                            orgId={orgId}
                            onChanged={() => void load()}
                          />
                        </div>
                      ) : null}
                      {bucket.items.length === 0 ? (
                        // Only say nothing is scheduled when that is true. A day
                        // with a deadline on it is not an empty day.
                        (taskDays.get(bucket.day)?.length ?? 0) === 0 ? (
                          <p className="tc-muted">Nothing scheduled this day.</p>
                        ) : (
                          <p className="tc-muted">No events — but there is work due.</p>
                        )
                      ) : (
                        bucket.items.map((event) => renderEventCard(event))
                      )}
                    </div>
                  ))
                )
              ) : null}

              {mode === "week" || mode === "day" ? (
                <TimedCalendarGrid
                  cells={timedCells}
                  githubItems={githubItems}
                  taskDays={taskDays}
                  today={todayKey}
                  orgId={orgId}
                  onTasksChanged={() => void load()}
                  selectedEventId={selectedEventId}
                  onSelectEvent={setSelectedEventId}
                  onPickSlot={(day, hour) => {
                    setQuickDay(day);
                    setQuickHour(hour);
                    setSelectedEventId(null);
                    document.getElementById("tc-quick-add")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                  onOpenDay={(day) => {
                    setMode("day");
                    setAnchor(parseLocalDay(day));
                    setQuickDay(day);
                    setQuickHour(null);
                  }}
                />
              ) : null}

              {mode === "month" ? (
                <div className="tc-month">
                  <div className="tc-month-head">
                    {WEEKDAYS.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                  <div className="tc-month-grid">
                    {monthCells.map((cell) => {
                      const github = overlayItemsForDay(githubItems, cell.day);
                      const dayTasks = taskDays.get(cell.day) ?? [];
                      const countLabel = monthEventCountLabel(
                        cell.items.length + github.length + dayTasks.length,
                      );
                      const { peeks, overflow } = monthEventPeek(
                        cell.items.map((event) => event.title),
                        github.length > 0 || dayTasks.length > 0 ? 1 : 2,
                      );
                      return (
                        <button
                          key={cell.day}
                          type="button"
                          className={[
                            "tc-month-cell",
                            cell.inMonth ? "" : "out",
                            cell.isToday ? "today" : "",
                            quickDay === cell.day ? "picked" : "",
                            cell.items.length > 0 || github.length > 0 || dayTasks.length > 0
                              ? "has-events"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          aria-label={monthCellLabel(
                            formatDayLabelLocal(cell.day),
                            cell.items.length + github.length,
                            dayTasks.length,
                          )}
                          onClick={() => {
                            setQuickDay(cell.day);
                            setQuickHour(null);
                            setAnchor(parseLocalDay(cell.day));
                            setMode("day");
                            setSelectedEventId(cell.items[0]?.id ?? null);
                            // Jump to the add form only when the day really is
                            // empty. A day whose one entry is a task due is why
                            // the person clicked; scrolling past it hides it.
                            if (cell.items.length === 0 && dayTasks.length === 0) {
                              document
                                .getElementById("tc-quick-add")
                                ?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }
                          }}
                        >
                          <header className="tc-month-cell-head">
                            <strong>{dayNum(cell.day)}</strong>
                            {countLabel ? <span className="tc-month-count">{countLabel}</span> : null}
                          </header>
                          <ul>
                            {peeks.map((title, index) => {
                              const event = cell.items[index]!;
                              return (
                                <li
                                  key={event.id}
                                  style={{ background: event.subteamColor ?? "var(--accent)" }}
                                  title={title}
                                >
                                  {title}
                                </li>
                              );
                            })}
                            {github.slice(0, 1).map((item) => (
                              <li key={item.id} className="tc-github-peek" title={item.title}>
                                GitHub · {item.title}
                              </li>
                            ))}
                            {dayTasks.slice(0, 1).map((task) => (
                              <li key={task.id} className="tc-task-peek" title={task.title}>
                                ☐ {task.title}
                              </li>
                            ))}
                            {dayTasks.length > 1 ? (
                              <li className="more">
                                +{dayTasks.length - 1} task{dayTasks.length - 1 === 1 ? "" : "s"} due
                              </li>
                            ) : null}
                            {overflow > 0 ? <li className="more">+{overflow}</li> : null}
                          </ul>
                          {cell.items.length === 0 &&
                          github.length === 0 &&
                          dayTasks.length === 0 &&
                          cell.inMonth ? (
                            <span className="tc-month-empty">Add</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {selectedEvent && mode !== "agenda" ? (
                <div className="tc-selected">{renderEventCard(selectedEvent)}</div>
              ) : null}
            </section>

            <aside className="tc-panel">
              {canManage ? <AiScheduler onUse={usePick} /> : null}
              <div id="tc-quick-add">
                <QuickAddForm
                  orgId={orgId}
                  subteams={view.subteams}
                  filterSubteamId={filterSubteamId}
                  initialStartsAt={quickStartsAt}
                  busy={busy}
                  run={run}
                  addTask={addTask}
                  onDone={() => {
                    setQuickDay(null);
                    setQuickHour(null);
                  }}
                />
              </div>

              <h2>Coming up</h2>
              {upcoming.length === 0 ? (
                <p className="tc-muted">Nothing upcoming in this filter.</p>
              ) : (
                <ul className="tc-upcoming">
                  {upcoming.map((event) => (
                    <li key={event.id}>
                      <button type="button" className="tc-upcoming-btn" onClick={() => setSelectedEventId(event.id)}>
                        <strong>{event.title}</strong>
                        <span>
                          {fmtWhen(event.startsAt)}
                          {event.subteamName ? ` · ${event.subteamName}` : " · Whole team"}
                          {event.myRsvp === "going" ? " · going" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <details
                className="tc-details"
                ref={detailsRef}
                open={detailsOpen}
                onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
              >
                <summary>More event details</summary>
                <CreateEventForm
                  orgId={orgId}
                  subteams={view.subteams}
                  attendanceEvents={view.attendanceEvents}
                  practiceSessions={view.practiceSessions}
                  filterSubteamId={filterSubteamId}
                  prefill={prefill}
                  busy={busy}
                  run={run}
                />
              </details>
            </aside>
          </div>
        </>
      )}
    </main>
  );
}

