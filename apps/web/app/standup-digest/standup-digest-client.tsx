"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { StandupDigestView } from "../../lib/standup-digest/compute-standup-digest";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";

type LiveView = Extract<StandupDigestView, { status: "live" }>;

export default function StandupDigestClient() {
  const [view, setView] = useState<StandupDigestView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
  const [date, setDate] = useState<string | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((dateOverride?: string) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const dateQuery = dateOverride ?? params.get("date");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (dateQuery) query.set("date", dateQuery);
    void fetch(`/api/standup-digest${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as StandupDigestView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setErrorMessage("error" in data && data.error ? data.error : null);
          setFetchFailed(true);
          return;
        }
        setView(data);
        setDate(data.digestDate);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/standup-digest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, digestDate: date ?? undefined, ...payload }),
        });
        const data = (await response.json()) as StandupDigestView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setDate(data.digestDate);
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, date, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Standup Digest"
        title="Morning Standup Digest"
        description="Yesterday's hours, task movement, blockers, attendance, and knowledge edits — compiled into a per-subteam brief."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view?.status === "live" ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Date
              <input
                type="date"
                value={date ?? view.digestDate}
                onChange={(event) => {
                  const next = event.target.value;
                  setDate(next);
                  load(next);
                }}
              />
            </label>
          ) : null}
          {orgId ? (
            <button type="button" className="app-button" disabled={busy} onClick={() => mutate({ action: "generate" })}>
              {busy ? "Generating…" : "Generate digest"}
            </button>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <RenderAttribution receipt={renderReceipt} feature="standup_digest" />

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: errorMessage,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: errorMessage,
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <HeadlinePanel view={view} />
          <SummaryTiles view={view} />
          <SubteamBriefs view={view} busy={busy} mutate={mutate} />
          <TaskMovementPanel view={view} />
          <BlockersPanel view={view} />
          <AttendancePanel view={view} />
          <KnowledgePanel view={view} />
          <NotesPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function HeadlinePanel({ view }: { view: LiveView }) {
  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>{view.digestDate}</h2>
          <small className="app-muted">{view.summary.headline}</small>
        </div>
        {view.latestRun ? (
          <small className="app-muted">
            Last generated {new Date(view.latestRun.createdAt).toLocaleString()}
            {view.latestRun.generatedByName ? ` by ${view.latestRun.generatedByName}` : ""}
          </small>
        ) : (
          <span className="app-badge setup">Not yet generated</span>
        )}
      </header>
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const completed = summary.taskMovement.filter((m) => m.event === "completed").length;
  const blocked = summary.taskMovement.filter((m) => m.event === "blocked").length;
  const tiles = [
    { label: "Hours logged", value: `${summary.hours.totalHours}` },
    { label: "Tasks completed", value: String(completed) },
    { label: "Newly blocked", value: String(blocked) },
    { label: "Open blockers", value: String(summary.blockers.length) },
    { label: "Attendees", value: String(summary.attendance.totalAttendees) },
    { label: "Wiki edits", value: String(summary.knowledgeEdits.length) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SubteamBriefs({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.subteamBriefs.length === 0) {
    return (
      <EmptyState
        badge="No movement yet"
        badgeTone="setup"
        title="No subteam activity logged for this date"
        description="Log hours, task movement, or attendance for this day, then generate the digest."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>By subteam</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.summary.subteamBriefs.map((brief) => (
          <li key={brief.subteam}>
            <strong style={{ textTransform: "capitalize" }}>{brief.subteam}</strong>
            <div className="app-muted">{brief.headline}</div>
            {brief.openBlockers.length > 0 ? (
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {brief.openBlockers.map((blocker) => (
                  <li key={blocker.taskId}>
                    {blocker.title}
                    {blocker.blockedReason ? ` — ${blocker.blockedReason}` : ""} ({blocker.ageDays}d old)
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 12 }}>
        <button type="button" className="app-button secondary" disabled={busy} onClick={() => mutate({ action: "generate" })}>
          Regenerate digest
        </button>
      </div>
    </Panel>
  );
}

function TaskMovementPanel({ view }: { view: LiveView }) {
  const { taskMovement } = view.summary;
  if (taskMovement.length === 0) {
    return <EmptyState title="No task movement" description="No tasks were created, completed, or blocked on this date." />;
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Task movement</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {taskMovement.map((item) => (
          <li key={item.taskId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>
              {item.title} <small className="app-muted">({item.subteam})</small>
            </span>
            <small className="app-muted">{item.event}{item.assignee ? ` · ${item.assignee}` : ""}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function BlockersPanel({ view }: { view: LiveView }) {
  const { blockers } = view.summary;
  if (blockers.length === 0) {
    return <EmptyState title="No open blockers" description="Nothing is currently marked blocked." />;
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Open blockers</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {blockers.map((blocker) => (
          <li key={blocker.taskId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>
              {blocker.title} <small className="app-muted">({blocker.subteam})</small>
            </span>
            <small className="app-muted">
              {blocker.blockedReason ?? "No reason logged"} · {blocker.ageDays}d old
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AttendancePanel({ view }: { view: LiveView }) {
  const { attendance } = view.summary;
  if (attendance.events.length === 0) {
    return <EmptyState title="No attendance logged" description="No attendance events were recorded for this date." />;
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Attendance</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {attendance.events.map((event) => (
          <li key={event.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{event.title}</span>
            <small className="app-muted">
              {event.attendeeCount} attendee(s) · {event.creditHours}h credit
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function KnowledgePanel({ view }: { view: LiveView }) {
  const { knowledgeEdits } = view.summary;
  if (knowledgeEdits.length === 0) {
    return <EmptyState title="No wiki edits" description="No knowledge pages were created or edited on this date." />;
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Knowledge edits</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
        {knowledgeEdits.map((edit) => (
          <li key={edit.pageId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{edit.title}</span>
            <small className="app-muted">
              {edit.created ? "created" : "edited"}
              {edit.updatedByName ? ` by ${edit.updatedByName}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function NotesPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [subteam, setSubteam] = useState("");
  const [note, setNote] = useState("");

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!subteam.trim() || !note.trim()) return;
        mutate({ action: "add-note", subteam, note });
        setSubteam("");
        setNote("");
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Follow-up notes</h2>
      {view.notes.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {view.notes.map((item) => (
            <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
              <div>
                <strong style={{ textTransform: "capitalize" }}>{item.subteam}</strong>
                <div>{item.note}</div>
                <small className="app-muted">
                  {item.createdByName ?? "Unknown"} · {new Date(item.createdAt).toLocaleString()}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "delete-note", noteId: item.id })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="app-muted">No follow-up notes yet for this date.</p>
      )}
      <FormRow label="Subteam">
        <input value={subteam} onChange={(event) => setSubteam(event.target.value)} placeholder="drivetrain" required />
      </FormRow>
      <FormRow label="Note">
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} required />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !subteam.trim() || !note.trim()}>
          Add note
        </button>
      </div>
    </Panel>
  );
}
