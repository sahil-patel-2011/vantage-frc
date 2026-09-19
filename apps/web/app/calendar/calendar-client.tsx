"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { describeShopTime, shopTimeLeft } from "../../lib/calendar/shop-time-left";
import { moveToDate } from "../../lib/calendar/move-entry";
import { localToday, monthLabel, monthOf } from "../../lib/calendar/month-grid";
import { hubHref } from "../../lib/nav/hubs";
import { CalendarMonth } from "./calendar-month";
import { CalendarRepeat, useRepeatRule } from "./calendar-repeat";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import {
  QUEUED_ON_DEVICE,
  getFeatureSnapshot,
  isBrowserOffline,
  putFeatureSnapshot,
  queueProductWrite,
  syncOutbox,
  useOnline,
} from "../../lib/offline";
import {
  applyCalendarLocalWrite,
  daysUntil,
  groupByMonth,
  milestonesInMonth,
  isCalendarQueueableAction,
  KIND_LABELS,
  meetingProvider,
  milestoneWorkflowLinks,
  MILESTONE_KINDS,
  nextUpcoming,
  seasonProgress,
  type CalendarView,
  type LinkedDeadline,
  type Milestone,
  type MilestoneKind,
  type SeasonTemplateId,
} from "../../lib/season-calendar";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type ActionBody = Record<string, unknown> & { action: string; orgId: string };
type ReadyView = Extract<CalendarView, { status: "ready" }>;

function isCalendarView(value: unknown): value is CalendarView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "ready";
}

async function persistCalendarSnapshot(orgHint: string, data: CalendarView): Promise<void> {
  const cacheOrg = data.context.orgId?.trim() || orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("calendar", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("calendar", "_", data);
  } catch {
    // Live season calendar already painted; IndexedDB is best-effort.
  }
}

function fmtDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function countdownLabel(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "in 1 day";
  return `in ${days} days`;
}

function MilestoneEditor({
  milestone,
  orgId,
  busy,
  onCancel,
  onSave,
}: {
  milestone: Milestone;
  orgId: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (body: ActionBody) => Promise<void>;
}) {
  const [title, setTitle] = useState(milestone.title);
  const [kind, setKind] = useState<MilestoneKind>(milestone.kind);
  const [startsOn, setStartsOn] = useState(milestone.startsOn);
  const [endsOn, setEndsOn] = useState(milestone.endsOn ?? "");
  const [notes, setNotes] = useState(milestone.notes);
  const [meetingUrl, setMeetingUrl] = useState(milestone.meetingUrl ?? "");

  return (
    <form
      className="cal-edit"
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({
          action: "update_milestone",
          orgId,
          id: milestone.id,
          patch: {
            title: title.trim(),
            kind,
            startsOn,
            endsOn: endsOn || null,
            notes: notes.trim(),
            meetingUrl: meetingUrl.trim() || null,
          },
        });
      }}
    >
      <FormGrid>
        <FormRow label="Title">
          <input value={title} disabled={busy} required maxLength={160} onChange={(event) => setTitle(event.target.value)} />
        </FormRow>
        <FormRow label="Kind">
          <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as MilestoneKind)}>
            {MILESTONE_KINDS.map((option) => (
              <option key={option} value={option}>
                {KIND_LABELS[option]}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Starts">
          <input type="date" value={startsOn} disabled={busy} required onChange={(event) => setStartsOn(event.target.value)} />
        </FormRow>
        <FormRow label="Ends">
          <input type="date" value={endsOn} disabled={busy} onChange={(event) => setEndsOn(event.target.value)} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes">
        <input value={notes} disabled={busy} placeholder="Optional notes" onChange={(event) => setNotes(event.target.value)} />
      </FormRow>
      <FormRow label="Meeting link">
        <input
          value={meetingUrl}
          disabled={busy}
          type="url"
          placeholder="https://… Zoom / Meet / Teams"
          onChange={(event) => setMeetingUrl(event.target.value)}
        />
      </FormRow>
      <div className="cal-edit-actions">
        <Button variant="primary" type="submit" disabled={busy || !title.trim() || !startsOn}>
          Save milestone
        </Button>
        <Button variant="secondary" type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function MilestoneRow({
  milestone,
  orgId,
  now,
  busyKey,
  editingId,
  setEditingId,
  run,
  seriesCount,
}: {
  milestone: Milestone;
  orgId: string;
  now: Date;
  busyKey: string | null;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  run: (body: ActionBody, key: string) => Promise<void>;
  /** How many entries this one was created alongside; 1 when it stands alone. */
  seriesCount: number;
}) {
  const busy = busyKey != null;
  const past = daysUntil(milestone.startsOn, now) < 0;
  const classes = ["cal-item"];
  if (milestone.done) classes.push("done");
  if (past) classes.push("past");
  const links = milestoneWorkflowLinks(milestone, orgId);

  if (editingId === milestone.id) {
    return (
      <li className="cal-item editing">
        <MilestoneEditor
          milestone={milestone}
          orgId={orgId}
          busy={busyKey === `edit:${milestone.id}`}
          onCancel={() => setEditingId(null)}
          onSave={async (body) => {
            await run(body, `edit:${milestone.id}`);
            setEditingId(null);
          }}
        />
      </li>
    );
  }

  return (
    <li className={classes.join(" ")}>
      <label className="cal-check">
        <input
          type="checkbox"
          checked={milestone.done}
          disabled={busyKey === `done:${milestone.id}`}
          aria-label={`Mark "${milestone.title}" ${milestone.done ? "not done" : "done"}`}
          onChange={(event) =>
            void run({ action: "toggle_done", orgId, id: milestone.id, done: event.target.checked }, `done:${milestone.id}`)
          }
        />
      </label>
      <div className="cal-item-main">
        <div className="cal-item-top">
          <strong>{milestone.title}</strong>
          <span className={`cal-chip kind-${milestone.kind}`}>{KIND_LABELS[milestone.kind]}</span>
        </div>
        <span className="cal-item-date">
          {fmtDate(milestone.startsOn)}
          {milestone.endsOn ? ` → ${fmtDate(milestone.endsOn)}` : ""}
          {milestone.done && milestone.doneByName ? (
            <small className="app-muted"> · done by {milestone.doneByName}</small>
          ) : null}
        </span>
        {milestone.notes ? <p className="cal-item-notes app-muted">{milestone.notes}</p> : null}
        {milestone.meetingUrl ? (
          <a className="cal-join" href={milestone.meetingUrl} target="_blank" rel="noopener noreferrer">
            ▶ Join {meetingProvider(milestone.meetingUrl) ?? "meeting"}
          </a>
        ) : null}
        {links.length > 0 ? (
          <div className="cal-workflow-links">
            {links.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </div>
        ) : null}
      </div>
      <div className="cal-item-actions">
        <button type="button" className="cal-link" disabled={busy} onClick={() => setEditingId(milestone.id)}>
          Edit
        </button>
        <button
          type="button"
          className="cal-link danger"
          aria-label="Delete milestone"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete milestone "${milestone.title}"?`)) {
              void run({ action: "delete_milestone", orgId, id: milestone.id }, `delete:${milestone.id}`);
            }
          }}
        >
          Delete
        </button>
        {/*
          The other half of expanding a schedule into real entries: one press
          made forty of these, and without this it takes forty to undo. Offered
          only where it means something — an entry that was created on its own
          has no series to delete.

          It says the number, because "Delete series" beside a Delete button is
          two words that could plausibly mean the same thing, and only one of
          them removes thirty-nine entries you are not looking at.
        */}
        {milestone.seriesId && seriesCount > 1 ? (
          <button
            type="button"
            className="cal-link danger"
            disabled={busy}
            onClick={() => {
              if (
                confirm(
                  `Delete all ${seriesCount} entries created with "${milestone.title}"? This cannot be undone.`,
                )
              ) {
                void run(
                  { action: "delete_series", orgId, seriesId: milestone.seriesId! },
                  `delete-series:${milestone.seriesId}`,
                );
              }
            }}
          >
            Delete all {seriesCount}
          </button>
        ) : null}
      </div>
    </li>
  );
}

function LinkedDeadlinesPanel({ items, orgId }: { items: LinkedDeadline[]; orgId: string }) {
  if (items.length === 0) {
    return (
      <Panel className="cal-linked">
        <h2>Business & purchase dates</h2>
        <p className="app-muted">
          Grant deadlines and purchase <em>needed by</em> dates from{" "}
          <a href={`/business?orgId=${encodeURIComponent(orgId)}`}>Business</a> appear here once they are set.
          Season spend lives in <a href={`/costs?orgId=${encodeURIComponent(orgId)}`}>Costs</a>.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="cal-linked">
      <h2>Business & purchase dates</h2>
      <p className="app-muted">Real dates from Business — open a row to edit there. Not part of the seed templates.</p>
      <ul>
        {items.map((item) => (
          <li key={`${item.source}:${item.id}`}>
            <a href={item.href}>
              <strong>{item.title}</strong>
              <span className="cal-chip kind-deadline">{item.source === "grant" ? "Grant" : "Purchase"}</span>
            </a>
            <span className="cal-item-date">{fmtDate(item.dueOn)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function CalendarClient() {
  const online = useOnline();
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [view, setView] = useState<CalendarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [kickoff, setKickoff] = useState("");
  const [templateId, setTemplateId] = useState<SeasonTemplateId>("build_season");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MilestoneKind>("build");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [notes, setNotes] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");
  const viewRef = useRef<CalendarView | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId")?.trim() ?? "";
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<CalendarView>("calendar", urlOrg || "_");
      if (!viewRef.current && cached?.data && isCalendarView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/calendar${urlOrg ? `?orgId=${encodeURIComponent(urlOrg)}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as CalendarView | { error?: string };
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setError("error" in data && data.error ? data.error : "Could not load the season calendar.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      if (!response.ok || !isCalendarView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Season Calendar. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setError("error" in data && data.error ? data.error : "Could not load the season calendar.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      await persistCalendarSnapshot(urlOrg, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Season Calendar. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    if (!orgId) return;
    const onOnline = () => {
      void syncOutbox({ orgId }).then(() => load());
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [load]);

  const run = useCallback(
    async (body: ActionBody, key: string) => {
      if (isBrowserOffline() && body.action === "seed_season") {
        setError("Adding a season template needs a connection. Ticking dates still saves on this device.");
        return;
      }
      if (isBrowserOffline() && isCalendarQueueableAction(body.action) && body.orgId) {
        await queueProductWrite({
          feature: "calendar_action",
          orgId: body.orgId,
          payload: body,
        });
        setView((current) => {
          if (!current) return current;
          const next = applyCalendarLocalWrite(current, body, new Date().toISOString());
          void persistCalendarSnapshot(String(body.orgId), next);
          return next;
        });
        setError(QUEUED_ON_DEVICE);
        return;
      }
      setBusyKey(key);
      setError("");
      try {
        const response = await fetch("/api/calendar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as { error?: string };
        if (!response.ok) {
          setError(data.error ?? "Action failed.");
          return;
        }
        await load();
      } catch {
        if (isBrowserOffline() && isCalendarQueueableAction(body.action) && body.orgId) {
          await queueProductWrite({
            feature: "calendar_action",
            orgId: body.orgId,
            payload: body,
          });
          setView((current) => {
            if (!current) return current;
            const next = applyCalendarLocalWrite(current, body, new Date().toISOString());
            void persistCalendarSnapshot(String(body.orgId), next);
            return next;
          });
          setError(QUEUED_ON_DEVICE);
          return;
        }
        setError("Network error — changes were not saved.");
      } finally {
        setBusyKey(null);
      }
    },
    [load],
  );

  if (!view) {
    return (
      <main className="module-page cal-page">
        <PageHeader breadcrumbs="Team / Calendar" title="Season calendar" />
        <OfflineBanner feature="Calendar" fromCache={fromCache} cachedAt={cachedAt} />
        {fetchFailed ? (
          (() => {
            const copy = loadFailureCopy(
              classifyLoadFailure({ status: errorStatus, message: error, online }),
              {
                nextPath:
                  typeof window === "undefined"
                    ? null
                    : `${window.location.pathname}${window.location.search}`,
                message: error || "Check your connection and try again.",
              },
            );
            return (
              <EmptyState soft title={copy.title} description={copy.description}>
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
              </EmptyState>
            );
          })()
        ) : (
          <Panel className="cal-empty">
            <p className="app-muted">Loading season calendar…</p>
          </Panel>
        )}
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page cal-page">
        <PageHeader breadcrumbs="Team / Calendar" title="Season calendar" />
        <OfflineBanner feature="Calendar" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState soft title="Choose your team" description={view.message}>
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  return (
    <ReadyCalendar
      view={view}
      error={error}
      fromCache={fromCache}
      cachedAt={cachedAt}
      busyKey={busyKey}
      editingId={editingId}
      setEditingId={setEditingId}
      run={run}
      kickoff={kickoff}
      setKickoff={setKickoff}
      templateId={templateId}
      setTemplateId={setTemplateId}
      title={title}
      setTitle={setTitle}
      kind={kind}
      setKind={setKind}
      startsOn={startsOn}
      setStartsOn={setStartsOn}
      endsOn={endsOn}
      setEndsOn={setEndsOn}
      notes={notes}
      setNotes={setNotes}
      meetingUrl={meetingUrl}
      setMeetingUrl={setMeetingUrl}
    />
  );
}

function ReadyCalendar({
  view,
  error,
  fromCache,
  cachedAt,
  busyKey,
  editingId,
  setEditingId,
  run,
  kickoff,
  setKickoff,
  templateId,
  setTemplateId,
  title,
  setTitle,
  kind,
  setKind,
  startsOn,
  setStartsOn,
  endsOn,
  setEndsOn,
  notes,
  setNotes,
  meetingUrl,
  setMeetingUrl,
}: {
  view: ReadyView;
  error: string;
  fromCache: boolean;
  cachedAt: string | null;
  busyKey: string | null;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  run: (body: ActionBody, key: string) => Promise<void>;
  kickoff: string;
  setKickoff: (value: string) => void;
  templateId: SeasonTemplateId;
  setTemplateId: (value: SeasonTemplateId) => void;
  title: string;
  setTitle: (value: string) => void;
  kind: MilestoneKind;
  setKind: (value: MilestoneKind) => void;
  startsOn: string;
  setStartsOn: (value: string) => void;
  endsOn: string;
  setEndsOn: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  meetingUrl: string;
  setMeetingUrl: (value: string) => void;
}) {
  const orgId = view.context.orgId ?? "";
  const milestones = view.milestones;
  // Recomputed from the same two lists the grid draws, so the sentence and the
  // squares can never disagree.
  const shopTime = shopTimeLeft(milestones, view.meetings ?? []);
  // Local to this form on purpose: a repeat rule is a thing you are typing,
  // not state the rest of the page has any use for.
  const repeat = useRepeatRule(startsOn);
  const busy = busyKey != null;
  const now = new Date();
  const next = nextUpcoming(milestones, now);
  const progress = seasonProgress(milestones);
  const months = groupByMonth(milestones);
  /**
   * The list under the grid is about the month the grid is about.
   *
   * It used to be every milestone in the season, every time — eighty rows
   * under a grid that was already showing them, and an "Add milestone" form
   * at the far end of a twelve-thousand-pixel page. Two views of the same
   * data, one of which you had to scroll past.
   *
   * Scoping it to the visible month makes the grid the way you navigate and
   * the list the way you edit, and `Whole season` is still there for the
   * once-a-year read-through.
   */
  // How many entries share each series id, counted once over the whole
  // season rather than per row: the button says the real number, including
  // the entries in months the list is not showing.
  const seriesCounts = new Map<string, number>();
  for (const row of milestones) {
    if (!row.seriesId) continue;
    seriesCounts.set(row.seriesId, (seriesCounts.get(row.seriesId) ?? 0) + 1);
  }

  /*
    Starts on this month, not on null.

    The grid reports which month it is showing, and it can only do that after
    it has mounted. Starting at null meant the first paint had no month to
    scope to, so it fell back to the whole season and then collapsed to one
    month a frame later — a page that visibly jumps, and a list that was
    briefly showing eighty rows it was about to take away.

    The grid opens on today unless somebody moves it, so this is the same
    answer it is about to give.
  */
  const [visibleMonth, setVisibleMonth] = useState<string>(() => monthOf(localToday()));
  const [wholeSeason, setWholeSeason] = useState(false);
  const shownMonths = wholeSeason
    ? months
    : [
        {
          month: visibleMonth,
          label: monthLabel(visibleMonth),
          items: milestonesInMonth(milestones, visibleMonth),
        },
      ];
  const selectedTemplate = view.templates.find((template) => template.id === templateId) ?? view.templates[0];

  const addMilestone = () => {
    if (!title.trim() || !startsOn) return;
    void run(
      {
        repeatOn: repeat.dates,
        action: "add_milestone",
        orgId,
        title: title.trim(),
        kind,
        startsOn,
        endsOn: endsOn || null,
        notes: notes.trim(),
        meetingUrl: meetingUrl.trim() || null,
      },
      "add",
    ).then(() => {
      setTitle("");
      setStartsOn("");
      setEndsOn("");
      setNotes("");
      setMeetingUrl("");
      repeat.reset();
    });
  };

  return (
    // `data-seeded` decides the stacking order below: on a calendar that
    // already has entries the once-a-season setup panels move under the grid,
    // and on an empty one they stay where a new team will find them.
    <main className="module-page cal-page" data-seeded={milestones.length > 0 ? "yes" : "no"}>
      <PageHeader breadcrumbs="Team / Calendar" title="Season calendar" />
      <OfflineBanner feature="Calendar" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <Panel className="cal-hero">
        <div className="cal-hero-next">
          <span className="cal-hero-kicker">Next milestone</span>
          {next ? (
            <>
              <span className="cal-countdown">{countdownLabel(daysUntil(next.startsOn, now))}</span>
              <div className="cal-hero-title">
                <strong>{next.title}</strong>
                <span className={`cal-chip kind-${next.kind}`}>{KIND_LABELS[next.kind]}</span>
              </div>
              <span className="app-muted">{fmtDate(next.startsOn)}</span>
              {next.meetingUrl ? (
                <a className="cal-join hero" href={next.meetingUrl} target="_blank" rel="noopener noreferrer">
                  ▶ Join {meetingProvider(next.meetingUrl) ?? "meeting"}
                </a>
              ) : null}
            </>
          ) : (
            <>
              <strong>Nothing upcoming</strong>
              <span className="app-muted">Opt into a season template below, or add a milestone.</span>
            </>
          )}
        </div>
        {/*
          "How many build nights are left before the competition" is the
          question a team actually asks in January, and the grid could only
          answer it by eye — squint, count the Tuesdays, forget the week
          everyone is away for finals, be wrong in the optimistic direction.

          Counted from entries the team really put on the calendar. When there
          is nothing to count down to, or nothing scheduled to count, this is
          absent rather than zero: a team that believes it has twenty nights
          left will commit to a rebuild it cannot finish.
        */}
        {shopTime ? (
          <div className="cal-hero-shop">
            <span className="cal-hero-kicker">Shop time before {shopTime.targetTitle}</span>
            <strong>{describeShopTime(shopTime)}</strong>
            <span className="app-muted">
              {shopTime.daysUntil === 0
                ? "Today"
                : `over ${shopTime.daysUntil} ${shopTime.daysUntil === 1 ? "day" : "days"}`}
            </span>
          </div>
        ) : null}

        <div className="cal-hero-progress">
          <span className="app-muted">
            {progress.done}/{progress.total} milestones done · {progress.percent}%
          </span>
          <div className="cal-track" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${progress.percent}%` }} className={progress.total > 0 && progress.done === progress.total ? "done" : undefined} />
          </div>
        </div>
      </Panel>

      <Panel as="details" className="cal-seed" open={milestones.length === 0}>
        <summary>Seed a season template</summary>
        <div className="cal-seed-body">
          <p className="app-muted">
            Templates are opt-in plans dated from your kickoff — not live TBA stats. Existing titles are skipped so you
            can layer packs (build + stop-build + outreach) safely.
          </p>
          <label className="cal-template-pick">
            <span>Template</span>
            <select
              value={templateId}
              disabled={busy}
              onChange={(event) => setTemplateId(event.target.value as SeasonTemplateId)}
            >
              {view.templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label} ({template.entryCount})
                </option>
              ))}
            </select>
          </label>
          {selectedTemplate ? <p className="app-muted cal-template-desc">{selectedTemplate.description}</p> : null}
          <div className="cal-seed-row">
            <input
              type="date"
              value={kickoff}
              disabled={busy}
              aria-label="Kickoff date"
              onChange={(event) => setKickoff(event.target.value)}
            />
            <Button variant="primary" type="button" disabled={busy || !kickoff} onClick={() => void run({ action: "seed_season", orgId, kickoffDate: kickoff, templateId }, "seed") }>
              Seed template
            </Button>
          </div>
        </div>
      </Panel>

      <LinkedDeadlinesPanel items={view.linkedDeadlines ?? []} orgId={orgId} />

      {/*
        The grid first, then the same milestones as a list.

        They are two readings of one set of entries, not two features: the grid
        answers "what does February look like" and the list answers "what is
        next, and let me edit it". The grid is not gated on there being
        milestones — an empty February is a useful thing to look at, and it is
        also where you add the first one.
      */}
      <CalendarMonth
        milestones={milestones}
        meetings={view.meetings}
        // The workbench tab, not the legacy `/team/calendar`, which only
        // redirects here — a chip should land where it says it lands.
        meetingHref={hubHref("/team", "calendar", orgId)}
        busy={busy}
        onCreate={async ({ title: newTitle, startsOn: on }) => {
          await run(
            {
              action: "add_milestone",
              orgId,
              title: newTitle,
              kind: "other",
              startsOn: on,
              endsOn: null,
              notes: "",
              meetingUrl: null,
            },
            "add",
          );
        }}
        onOpen={(milestone) => setEditingId(milestone.id)}
        onMonthChange={setVisibleMonth}
        onMove={async (milestone, toDate) => {
          const patch = moveToDate(milestone, toDate);
          if (!patch) return;
          await run({ action: "update_milestone", orgId, id: milestone.id, patch }, `move-${milestone.id}`);
        }}
      />

      {months.length > 0 ? (
        <div className="cal-list-scope">
          <span className="app-muted">
            {wholeSeason
              ? `Whole season · ${milestones.length} ${milestones.length === 1 ? "entry" : "entries"}`
              : `Showing ${monthLabel(visibleMonth)}`}
          </span>
          <button type="button" className="cal-link" onClick={() => setWholeSeason((on) => !on)}>
            {wholeSeason ? "Just this month" : "Whole season"}
          </button>
        </div>
      ) : null}

      {months.length === 0 ? (
        <EmptyState
          soft
          title="Nothing on the calendar yet"
          description="Press a day above to add something, or seed a season template from your kickoff date."
        />
      ) : shownMonths.every((group) => group.items.length === 0) ? (
        <EmptyState
          soft
          title={`Nothing in ${monthLabel(visibleMonth)}`}
          description="Press a day above to add something here, or read the whole season."
        />
      ) : (
        shownMonths.map((group) => (
          <section key={group.month} className="cal-month">
            <h2>
              {group.label}
              <span>{group.items.length}</span>
            </h2>
            <ul>
              {group.items.map((milestone) => (
                <MilestoneRow
                  key={milestone.id}
                  milestone={milestone}
                  orgId={orgId}
                  now={now}
                  busyKey={busyKey}
                  editingId={editingId}
                  setEditingId={setEditingId}
                  run={run}
                  seriesCount={milestone.seriesId ? (seriesCounts.get(milestone.seriesId) ?? 1) : 1}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <Panel
        as="form"
        className="cal-add"
        onSubmit={(event) => {
          event.preventDefault();
          addMilestone();
        }}
      >
        <h2>Add milestone</h2>
        <FormGrid>
          <FormRow label="Title">
            <input
              value={title}
              disabled={busy}
              placeholder="e.g. Week 2 scrimmage"
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormRow>
          <FormRow label="Kind">
            <select value={kind} disabled={busy} onChange={(event) => setKind(event.target.value as MilestoneKind)}>
              {MILESTONE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {KIND_LABELS[option]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Starts">
            <input type="date" value={startsOn} disabled={busy} onChange={(event) => setStartsOn(event.target.value)} />
          </FormRow>
          <FormRow label="Ends">
            <input type="date" value={endsOn} disabled={busy} onChange={(event) => setEndsOn(event.target.value)} />
          </FormRow>
        </FormGrid>
        <FormRow label="Notes">
          <input value={notes} disabled={busy} placeholder="Optional" onChange={(event) => setNotes(event.target.value)} />
        </FormRow>
        <FormRow label="Meeting link">
          <input
            value={meetingUrl}
            disabled={busy}
            type="url"
            placeholder="Optional Zoom / Meet / Teams URL"
            onChange={(event) => setMeetingUrl(event.target.value)}
          />
        </FormRow>

        {/* A build season is mostly the same evening over and over, and this
            form could only be told about one evening at a time. */}
        <CalendarRepeat state={repeat} disabled={busy} startsOn={startsOn} />
        <Button variant="primary" type="submit" disabled={busy || !title.trim() || !startsOn}>
          {repeat.dates.length > 1 ? `Add ${repeat.dates.length} entries` : "Add milestone"}
        </Button>
      </Panel>

      <AiInsightPanel
        orgId={orgId}
        kind="schedule_risk"
        title="Schedule risk"
        description="AI pace check — overdue milestones, this week's load, and what threatens the next event."
      />
    </main>
  );
}
