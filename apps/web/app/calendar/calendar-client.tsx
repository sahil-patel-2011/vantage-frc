"use client";

import { useCallback, useEffect, useState } from "react";
import { AiInsightPanel } from "../../components/ai-insight-panel";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
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
        <button type="submit" className="app-button" disabled={busy || !title.trim() || !startsOn}>
          Save milestone
        </button>
        <button type="button" className="app-button secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
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
}: {
  milestone: Milestone;
  orgId: string;
  now: Date;
  busyKey: string | null;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  run: (body: ActionBody, key: string) => Promise<void>;
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

  const load = useCallback(async () => {
    setFetchFailed(false);
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get("orgId") ?? "";
    const cached = orgId ? await getFeatureSnapshot<CalendarView>("calendar", orgId) : null;
    if (cached?.data) {
      setView(cached.data);
      setFromCache(true);
      setCachedAt(cached.cachedAt);
    }
    try {
      const response = await fetch(`/api/calendar${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`);
      const data = (await response.json()) as CalendarView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setError("error" in data && data.error ? data.error : "Could not load the season calendar.");
        setErrorStatus(response.status);
        if (!cached) setFetchFailed(true);
        return;
      }
      setError("");
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      const cacheOrg = ("context" in data && data.context.orgId) || orgId;
      if (cacheOrg) await putFeatureSnapshot("calendar", cacheOrg, data);
    } catch {
      if (!cached) setFetchFailed(true);
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
        setView((current) => (current ? applyCalendarLocalWrite(current, body, new Date().toISOString()) : current));
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
          setView((current) => (current ? applyCalendarLocalWrite(current, body, new Date().toISOString()) : current));
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

  if (fetchFailed || !view) {
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
                  <a className="app-button" href={copy.primary.href}>
                    {copy.primary.label}
                  </a>
                ) : null}
                {copy.showRetry ? (
                  <button type="button" className="app-button secondary" onClick={() => void load()}>
                    Retry
                  </button>
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
        <EmptyState soft title="Choose a team" description={view.message}>
          <a className="app-button" href="/workspace">
            Choose workspace
          </a>
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
  const busy = busyKey != null;
  const now = new Date();
  const next = nextUpcoming(milestones, now);
  const progress = seasonProgress(milestones);
  const months = groupByMonth(milestones);
  const selectedTemplate = view.templates.find((template) => template.id === templateId) ?? view.templates[0];

  const addMilestone = () => {
    if (!title.trim() || !startsOn) return;
    void run(
      {
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
    });
  };

  return (
    <main className="module-page cal-page">
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
            <button
              type="button"
              className="app-button"
              disabled={busy || !kickoff}
              onClick={() =>
                void run({ action: "seed_season", orgId, kickoffDate: kickoff, templateId }, "seed")
              }
            >
              Seed template
            </button>
          </div>
        </div>
      </Panel>

      <LinkedDeadlinesPanel items={view.linkedDeadlines ?? []} orgId={orgId} />

      {months.length === 0 ? (
        <EmptyState
          soft
          title="No milestones yet"
          description="Seed a template from your kickoff date, or add your first milestone below."
        />
      ) : (
        months.map((group) => (
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
        <button type="submit" className="app-button" disabled={busy || !title.trim() || !startsOn}>
          Add milestone
        </button>
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
