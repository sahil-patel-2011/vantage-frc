"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import type { StandupView } from "../../lib/standup";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<StandupView, { status: "live" }>;
type EmptyView = Extract<StandupView, { status: "empty" }>;

export default function StandupDigestClient() {
  const [view, setView] = useState<StandupView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);

  const load = useCallback((dateOverride?: string) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const dateQuery = dateOverride ?? params.get("date");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (dateQuery) query.set("date", dateQuery);
    void fetch(`/api/standup-digest${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as StandupView | { error?: string };
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

  const digestDate = date ?? (view && "digestDate" in view ? view.digestDate : "");

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Work / Standup"
        title="Morning standup"
        description="Yesterday's closed hours and task movement — compiled only from work that actually happened."
      >
        {view && view.status !== "setup_required" ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Date
            <input
              type="date"
              value={digestDate}
              onChange={(event) => {
                const next = event.target.value;
                setDate(next);
                load(next);
              }}
            />
          </label>
        ) : null}
      </PageHeader>

      {fetchFailed ? (
        <LoadFailure
          status={errorStatus}
          message={errorMessage}
          onRetry={() => load()}
        />
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking hours and work for this date." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <StepList steps={view.steps} />
        </EmptyState>
      ) : view.status === "empty" ? (
        <EmptyDigest view={view} />
      ) : (
        <LiveDigest view={view} />
      )}
    </main>
  );
}

function LoadFailure({
  status,
  message,
  onRetry,
}: {
  status: number | null;
  message: string | null;
  onRetry: () => void;
}) {
  const copy = loadFailureCopy(
    classifyLoadFailure({
      status,
      message,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    }),
    {
      nextPath: typeof window === "undefined" ? null : `${window.location.pathname}${window.location.search}`,
      message,
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
        <button type="button" className="app-button secondary" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </EmptyState>
  );
}

function StepList({ steps }: { steps: Array<{ id: string; label: string; detail: string; href: string }> }) {
  return (
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
  );
}

function EmptyDigest({ view }: { view: EmptyView }) {
  return (
    <EmptyState
      badge="No work yet"
      badgeTone="setup"
      title={view.message}
      description={
        view.standingBlockers > 0
          ? `${view.standingBlockers} blocked task${view.standingBlockers === 1 ? "" : "s"} are still open on Work — they are not yesterday's digest.`
          : "Clock hours or finish a task, then this page will compile that day. Nothing is invented while the logs are empty."
      }
    >
      <StepList steps={view.steps} />
    </EmptyState>
  );
}

function LiveDigest({ view }: { view: LiveView }) {
  const { digest } = view;
  const completed = digest.movement.filter((row) => row.event === "completed").length;
  const opened = digest.movement.filter((row) => row.event === "created").length;
  const blocked = digest.movement.filter((row) => row.event === "blocked").length;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0 }}>{digest.digestDate}</h2>
            <small className="app-muted">{digest.headline}</small>
          </div>
        </header>
      </Panel>

      <Panel>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
          <Tile label="Hours logged" value={String(digest.hours.totalHours)} />
          {completed > 0 ? <Tile label="Completed" value={String(completed)} /> : null}
          {opened > 0 ? <Tile label="Opened" value={String(opened)} /> : null}
          {blocked > 0 ? <Tile label="Blocked" value={String(blocked)} /> : null}
        </div>
      </Panel>

      {digest.hours.contributors.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Hours</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {digest.hours.contributors.map((row) => (
              <li key={row.userId} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>{row.name}</span>
                <small className="app-muted">{row.hours}h</small>
              </li>
            ))}
          </ul>
          {digest.hours.byKind.length > 0 ? (
            <p className="app-muted" style={{ marginBottom: 0 }}>
              {digest.hours.byKind.map((row) => `${row.kind} ${row.hours}h`).join(" · ")}
            </p>
          ) : null}
        </Panel>
      ) : null}

      {digest.movement.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Task movement</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {digest.movement.map((item) => (
              <li key={`${item.source}:${item.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  <a href={item.href}>{item.title}</a>
                  {item.grouping ? <small className="app-muted"> ({item.grouping})</small> : null}
                </span>
                <small className="app-muted">
                  {item.event}
                  {item.owners.length > 0 ? ` · ${item.owners.join(", ")}` : ""}
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {digest.blockers.length > 0 ? (
        <Panel>
          <h2 style={{ marginTop: 0 }}>Open blockers</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {digest.blockers.map((blocker) => (
              <li key={`${blocker.source}:${blocker.id}`} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span>
                  <a href={blocker.href}>{blocker.title}</a>
                  {blocker.grouping ? <small className="app-muted"> ({blocker.grouping})</small> : null}
                </span>
                <small className="app-muted">
                  {blocker.owners.length > 0 ? `${blocker.owners.join(", ")} · ` : ""}
                  {blocker.ageDays}d old
                </small>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <strong style={{ fontSize: "1.6rem", display: "block" }}>{value}</strong>
      <span className="app-muted">{label}</span>
    </div>
  );
}
