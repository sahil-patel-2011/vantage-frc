"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { checklistItemLabel, formatElapsed } from "../../lib/match-checklist";
import type { MatchChecklistView } from "../../lib/match-checklist/compute-match-checklist";
import type { ChecklistItemKey, MatchChecklistRun } from "../../lib/match-checklist/types";

type LiveView = Extract<MatchChecklistView, { status: "live" }>;

export default function MatchChecklistClient() {
  const [view, setView] = useState<MatchChecklistView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, forceTick] = useState(0);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/match-checklist${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchChecklistView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Tick every second so open runs show a live-updating elapsed time.
  useEffect(() => {
    const id = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/match-checklist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as MatchChecklistView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>
              Competition
            </a>
            {" / Match Checklist"}
          </>
        }
        title="Pre-Match Checklist"
        description="One-tap timed checklist per match — bumpers, battery, tether, code — so pit crews know exactly when the robot is ready."
      >
        {orgId ? (
          <nav
            className="intel-actions"
            aria-label="Related competition tools"
            style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          >
            <a
              className="app-button secondary"
              href={`/competition?tab=scouting&orgId=${encodeURIComponent(orgId)}`}
            >
              Scouting
            </a>
            <a
              className="app-button secondary"
              href={`/competition?tab=forms&orgId=${encodeURIComponent(orgId)}`}
            >
              Form builder
            </a>
            <a
              className="app-button secondary"
              href={`/competition?tab=strategy&orgId=${encodeURIComponent(orgId)}`}
            >
              Strategy
            </a>
            <a
              className="app-button secondary"
              href={`/competition?tab=command&orgId=${encodeURIComponent(orgId)}`}
            >
              Command
            </a>
          </nav>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the checklist"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
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
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <StartRunForm busy={busy} mutate={mutate} />
          <RunList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Total runs", value: String(summary.totalRuns) },
    { label: "Completed", value: String(summary.completedRuns) },
    { label: "In progress", value: String(summary.openRuns) },
    { label: "Avg time", value: formatElapsed(summary.averageElapsedSeconds) },
    { label: "Fastest", value: formatElapsed(summary.fastestElapsedSeconds) },
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

function StartRunForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ matchLabel: "", eventKey: "", teamNumber: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.matchLabel.trim()) return;
        mutate({
          action: "start-run",
          matchLabel: form.matchLabel,
          eventKey: form.eventKey || undefined,
          teamNumber: form.teamNumber ? Number(form.teamNumber) : undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Start checklist</h2>
      <FormGrid min={160}>
        <FormRow label="Match">
          <input value={form.matchLabel} onChange={set("matchLabel")} placeholder="Qualification 12" required />
        </FormRow>
        <FormRow label="Event (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
        <FormRow label="Team # (optional)">
          <input type="number" min={1} value={form.teamNumber} onChange={set("teamNumber")} />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.matchLabel.trim()}>
          Start
        </button>
      </div>
    </Panel>
  );
}

function RunList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.runs.length === 0) {
    return (
      <EmptyState
        badge="No checklists yet"
        badgeTone="setup"
        title="Start your first pre-match checklist"
        description="Tap through bumper, battery, tether, and code before every match to track readiness time."
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {view.runs.map((run) => (
        <RunCard key={run.id} run={run} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function RunCard({
  run,
  busy,
  mutate,
}: {
  run: MatchChecklistRun;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const elapsed =
    run.startedAt != null
      ? Math.max(
          0,
          Math.round(
            ((run.completedAt ? new Date(run.completedAt).getTime() : Date.now()) -
              new Date(run.startedAt).getTime()) /
              1000,
          ),
        )
      : null;

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${run.allDone ? "good" : "setup"}`}>
            {run.allDone ? "READY" : "IN PROGRESS"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>{run.matchLabel}</h2>
          <small className="app-muted">
            {run.eventKey ? `${run.eventKey} · ` : ""}
            {run.teamNumber ? `Team ${run.teamNumber} · ` : ""}
            {formatElapsed(elapsed)}
          </small>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete checklist for "${run.matchLabel}"?`)) {
              mutate({ action: "delete-run", runId: run.id });
            }
          }}
        >
          Delete
        </button>
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 8,
          marginTop: 12,
        }}
      >
        {run.items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`app-button ${item.done ? "" : "secondary"}`}
            disabled={busy}
            onClick={() => mutate({ action: "toggle-item", runId: run.id, itemKey: item.key as ChecklistItemKey })}
          >
            {item.done ? "✓ " : ""}
            {checklistItemLabel(item.key)}
          </button>
        ))}
      </div>
    </Panel>
  );
}
