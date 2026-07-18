"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { formatGoalValue, goalCategoryLabel, goalStatusLabel } from "../../lib/goals";
import {
  GOAL_CATEGORIES,
  GOAL_PRIORITIES,
  METRIC_TYPES,
  type GoalsView,
} from "../../lib/goals/compute-goals";
import type { GoalCategory, GoalEvaluation, GoalPriority, GoalStatus, MetricType } from "../../lib/goals/types";

type LiveView = Extract<GoalsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function statusColor(status: GoalStatus): string {
  switch (status) {
    case "achieved":
      return "#1f7a3d";
    case "at_risk":
      return "#b26a00";
    case "missed":
      return "#c02626";
    case "in_progress":
      return "#1f4fd6";
    default:
      return "#8a8f98";
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const METRIC_LABEL: Record<MetricType, string> = {
  percent: "Percent (0–100)",
  count: "Count",
  currency: "Dollars",
  binary: "Yes / no",
};

export default function GoalsClient() {
  const [view, setView] = useState<GoalsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/goals${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as GoalsView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/goals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as GoalsView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Season Goals"
        title="Season Goals & Objectives"
        description={
          <>
            Set the measurable objectives that define a successful season — competition, technical, outreach, and
            business — and track progress toward each with a live scorecard.
          </>
        }
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load season goals"
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
          <Scorecard view={view} />
          {view.summary.needsAttention.length > 0 ? <NeedsAttention view={view} /> : null}
          <AddGoalForm busy={busy} mutate={mutate} />
          <GoalList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function Scorecard({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Goals", value: String(s.total) },
    { label: "Achieved", value: `${s.achieved}/${s.total}` },
    { label: "At risk / missed", value: String(s.statusCounts.at_risk + s.statusCounts.missed) },
    { label: "Season progress", value: pct(s.weightedProgress) },
  ];
  return (
    <Panel style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      <div>
        <div className="mini-probability" aria-hidden="true">
          <i style={{ width: `${Math.max(2, s.weightedProgress * 100)}%`, background: "#1f4fd6" }} />
        </div>
        <small className="app-muted">Priority-weighted progress across all goals</small>
      </div>
      {s.byCategory.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {s.byCategory.map((row) => (
            <span key={row.category} className="app-badge demo" title={`${row.achieved}/${row.total} achieved`}>
              {goalCategoryLabel(row.category)}: {pct(row.avgProgress)}
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function NeedsAttention({ view }: { view: LiveView }) {
  return (
    <Panel style={{ borderLeft: "3px solid #b26a00" }}>
      <h2 style={{ marginTop: 0 }}>Needs attention</h2>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.summary.needsAttention.map((evaluation) => (
          <li key={evaluation.goal.id}>
            <strong>{evaluation.goal.title}</strong>{" "}
            <span style={{ color: statusColor(evaluation.status) }}>· {goalStatusLabel(evaluation.status)}</span>
            <span className="app-muted">
              {" "}
              · {pct(evaluation.progress)}
              {evaluation.daysToDue != null
                ? evaluation.daysToDue < 0
                  ? ` · ${Math.abs(evaluation.daysToDue)}d overdue`
                  : ` · due in ${evaluation.daysToDue}d`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function AddGoalForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      title: "",
      category: "competition" as GoalCategory,
      metricType: "count" as MetricType,
      targetValue: "",
      unit: "",
      dueOn: "",
      priority: "normal" as GoalPriority,
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const isBinary = form.metricType === "binary";

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-goal",
          title: form.title,
          category: form.category,
          metricType: form.metricType,
          targetValue: isBinary ? 1 : form.targetValue || 0,
          unit: form.metricType === "count" && form.unit ? form.unit : undefined,
          dueOn: form.dueOn || undefined,
          priority: form.priority,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add goal</h2>
      <FormGrid min={140}>
        <FormRow label="Objective" wide>
          <input value={form.title} onChange={set("title")} placeholder="Qualify for the district championship" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {GOAL_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {goalCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Measure">
          <select value={form.metricType} onChange={set("metricType")}>
            {METRIC_TYPES.map((metric) => (
              <option key={metric} value={metric}>
                {METRIC_LABEL[metric]}
              </option>
            ))}
          </select>
        </FormRow>
        {!isBinary ? (
          <FormRow label="Target">
            <input type="number" min={0} step="any" value={form.targetValue} onChange={set("targetValue")} required />
          </FormRow>
        ) : null}
        {form.metricType === "count" ? (
          <FormRow label="Unit (optional)">
            <input value={form.unit} onChange={set("unit")} placeholder="matches, hours…" />
          </FormRow>
        ) : null}
        <FormRow label="Priority">
          <select value={form.priority} onChange={set("priority")}>
            {GOAL_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>
                {priority[0]?.toUpperCase() + priority.slice(1)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Due (optional)">
          <input type="date" value={form.dueOn} onChange={set("dueOn")} />
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add goal
        </button>
      </div>
    </Panel>
  );
}

function GoalList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  if (view.evaluations.length === 0) {
    return (
      <EmptyState
        badge="No goals yet"
        badgeTone="setup"
        title="Set your season objectives"
        description="Add a goal above — a target you can measure (matches won, outreach hours, dollars raised, a yes/no milestone)."
      />
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
      {view.evaluations.map((evaluation) => (
        <GoalCard key={evaluation.goal.id} evaluation={evaluation} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function GoalCard({ evaluation, busy, mutate }: { evaluation: GoalEvaluation; busy: boolean; mutate: Mutate }) {
  const { goal, progress, status, daysToDue } = evaluation;
  return (
    <Panel as="article">
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge" style={{ background: statusColor(status), color: "#fff" }}>
            {goalStatusLabel(status)}
          </span>{" "}
          <small className="app-muted">
            {goalCategoryLabel(goal.category)} · {goal.priority}
            {daysToDue != null
              ? daysToDue < 0
                ? ` · ${Math.abs(daysToDue)}d overdue`
                : ` · due in ${daysToDue}d`
              : ""}
          </small>
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>{goal.title}</h2>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong style={{ fontSize: "1.3rem" }}>{pct(progress)}</strong>
          <small className="app-muted" style={{ display: "block" }}>{formatGoalValue(goal)}</small>
        </div>
      </header>

      <div className="mini-probability" aria-hidden="true" style={{ margin: "10px 0" }}>
        <i style={{ width: `${Math.max(2, progress * 100)}%`, background: statusColor(status) }} />
      </div>

      <footer style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {goal.metricType === "binary" ? (
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() =>
              mutate({ action: "update-goal", goalId: goal.id, currentValue: goal.currentValue >= 1 ? 0 : 1 })
            }
          >
            {goal.currentValue >= 1 ? "Mark not done" : "Mark done"}
          </button>
        ) : (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Progress
            <input
              type="number"
              min={0}
              step="any"
              defaultValue={goal.currentValue}
              disabled={busy}
              aria-label={`Current value for ${goal.title}`}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              onBlur={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next !== goal.currentValue) {
                  mutate({ action: "update-goal", goalId: goal.id, currentValue: next });
                }
              }}
              style={{ width: 100 }}
            />
            <span>/ {goal.metricType === "currency" ? `$${goal.targetValue.toLocaleString()}` : goal.targetValue}
              {goal.metricType === "percent" ? "%" : goal.unit ? ` ${goal.unit}` : ""}</span>
          </label>
        )}
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Delete "${goal.title}"?`)) mutate({ action: "delete-goal", goalId: goal.id });
          }}
          style={{ marginLeft: "auto" }}
        >
          Delete
        </button>
      </footer>
    </Panel>
  );
}
