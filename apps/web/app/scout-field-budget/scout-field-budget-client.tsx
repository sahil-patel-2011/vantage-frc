"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { fieldBudgetPhaseLabel } from "../../lib/scout-field-budget";
import type { ScoutFieldBudgetView } from "../../lib/scout-field-budget/compute-scout-field-budget";
import type { FieldBudgetLintResult, FieldBudgetSeverity } from "../../lib/scout-field-budget/types";

function severityTone(severity: FieldBudgetSeverity): string {
  if (severity === "critical") return "demo";
  if (severity === "warning") return "setup";
  return "good";
}

type LiveView = Extract<ScoutFieldBudgetView, { status: "live" }>;

export default function ScoutFieldBudgetClient() {
  const [view, setView] = useState<ScoutFieldBudgetView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/scout-field-budget${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutFieldBudgetView | { error?: string };
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/scout-field-budget", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as ScoutFieldBudgetView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Field-Count Budget"}
          </>
        }
        title="Scouting Field-Count Budget"
        description="Log a scouting schema's per-phase field count and lint it against a realistic per-match budget before it hits the field."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the field-count budget linter"
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
          <BudgetTiles view={view} />
          <SnapshotForm busy={busy} mutate={mutate} />
          {view.summary.totalSnapshots > 0 ? <SnapshotList view={view} busy={busy} mutate={mutate} /> : <NoSnapshots />}
        </div>
      )}
    </main>
  );
}

function BudgetTiles({ view }: { view: LiveView }) {
  const { summary, budgets } = view;
  const tiles = [
    { label: "Schemas linted", value: String(summary.totalSnapshots) },
    { label: "Over budget", value: String(summary.overBudgetCount) },
    { label: "Within budget", value: String(summary.okCount) },
    { label: "Avg live-match fields", value: String(summary.averageLiveFields) },
  ];
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Budget at a glance</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <strong className="app-muted">Per-phase budgets</strong>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
          {Object.entries(budgets).map(([phase, budget]) => (
            <li key={phase}>
              {fieldBudgetPhaseLabel(phase as Parameters<typeof fieldBudgetPhaseLabel>[0])}: {budget} fields
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function NoSnapshots() {
  return (
    <EmptyState
      badge="No schemas linted yet"
      badgeTone="setup"
      title="Log your first schema snapshot"
      description="Record how many fields each match phase of your scouting schema asks for and see whether it fits a realistic per-match budget."
    />
  );
}

function SnapshotList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Linted schemas</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.lints.map((lint) => (
          <LintRow key={lint.snapshotId} lint={lint} busy={busy} mutate={mutate} />
        ))}
      </ul>
    </Panel>
  );
}

function LintRow({
  lint,
  busy,
  mutate,
}: {
  lint: FieldBudgetLintResult;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <li style={{ display: "grid", gap: 6, borderBottom: "1px solid var(--app-border, #e5e7eb)", paddingBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div>
          <span className={`app-badge ${severityTone(lint.severity)}`}>{lint.severity.toUpperCase()}</span>
          <strong style={{ marginLeft: 8 }}>{lint.schemaName}</strong>
          <small className="app-muted" style={{ display: "block" }}>
            {lint.liveFields} live-match fields (budget {lint.liveBudget}) · {lint.totalFields} total fields
          </small>
        </div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${lint.schemaName}"?`)) {
              mutate({ action: "delete-snapshot", snapshotId: lint.snapshotId });
            }
          }}
        >
          Delete
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 2 }}>
        {lint.phases.map((phase) => (
          <li key={phase.phase} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{fieldBudgetPhaseLabel(phase.phase)}</span>
            <small className={phase.overBudget ? "app-muted" : "app-muted"} style={{ color: phase.overBudget ? "var(--app-danger, #dc2626)" : undefined }}>
              {phase.count} / {phase.budget}
              {phase.overBudget ? ` (+${phase.overBy})` : ""}
            </small>
          </li>
        ))}
      </ul>
      {lint.recommendations.length > 0 ? (
        <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {lint.recommendations.map((rec) => (
            <li key={rec}>
              <small className="app-muted">{rec}</small>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function SnapshotForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      schemaName: "",
      autoFields: "",
      teleopFields: "",
      endgameFields: "",
      pitFields: "",
      postMatchFields: "",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.schemaName.trim()) return;
        mutate({
          action: "log-snapshot",
          schemaName: form.schemaName,
          autoFields: Number(form.autoFields) || 0,
          teleopFields: Number(form.teleopFields) || 0,
          endgameFields: Number(form.endgameFields) || 0,
          pitFields: Number(form.pitFields) || 0,
          postMatchFields: Number(form.postMatchFields) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Lint a schema</h2>
      <FormGrid min={160}>
        <FormRow label="Schema name">
          <input value={form.schemaName} onChange={set("schemaName")} placeholder="2026 Reefscape v2" required />
        </FormRow>
        <FormRow label="Auto fields">
          <input type="number" min={0} value={form.autoFields} onChange={set("autoFields")} />
        </FormRow>
        <FormRow label="Teleop fields">
          <input type="number" min={0} value={form.teleopFields} onChange={set("teleopFields")} />
        </FormRow>
        <FormRow label="Endgame fields">
          <input type="number" min={0} value={form.endgameFields} onChange={set("endgameFields")} />
        </FormRow>
        <FormRow label="Pit fields">
          <input type="number" min={0} value={form.pitFields} onChange={set("pitFields")} />
        </FormRow>
        <FormRow label="Post-match fields">
          <input type="number" min={0} value={form.postMatchFields} onChange={set("postMatchFields")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.schemaName.trim()}>
          Lint schema
        </button>
      </div>
    </Panel>
  );
}
