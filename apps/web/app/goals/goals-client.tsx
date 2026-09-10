"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { TeamHubRelated } from "../../components/team-hub-related";
import { formatGoalValue, goalCategoryLabel, goalStatusLabel } from "../../lib/goals";
import {
  GOAL_CATEGORIES,
  GOAL_PRIORITIES,
  METRIC_TYPES,
  type GoalsView,
} from "../../lib/goals/compute-goals";
import {
  GOALS_TEAM_RELATED_INCLUDE,
  formatGoalsAchievedDisplay,
  formatGoalsProgressDisplay,
  goalsNextActions,
  goalsRelatedLinks,
} from "../../lib/goals/goals-related";
import type { GoalCategory, GoalEvaluation, GoalPriority, GoalStatus, MetricType } from "../../lib/goals/types";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./goals.css";

type LiveView = Extract<GoalsView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

const METRIC_LABEL: Record<MetricType, string> = {
  percent: "Percent (0–100)",
  count: "Count",
  currency: "Dollars",
  binary: "Yes / no",
};

function GoalsRelated({ orgId }: { orgId: string }) {
  const primary = goalsRelatedLinks(orgId, { include: ["todos", "practice", "team"] });
  return (
    <div className="goals-related">
      <nav className="product-hub-related goals-hub-related" aria-label="Related team tools">
        {primary.map((link) => (
          <Button as="a" variant="secondary" key={link.id} href={link.href}>
            {link.label}
          </Button>
        ))}
      </nav>
      <TeamHubRelated orgId={orgId} include={[...GOALS_TEAM_RELATED_INCLUDE]} />
    </div>
  );
}

function NextActions({
  orgId,
  goalCount,
  achieved,
  needsAttention,
  topTitle,
}: {
  orgId?: string | null;
  goalCount: number;
  achieved: number;
  needsAttention: number;
  topTitle?: string | null;
}) {
  const actions = goalsNextActions({
    orgId,
    goalCount,
    achieved,
    needsAttention,
    topTitle,
  });
  return (
    <section className="goals-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Prioritized from logged season goals — progress stays blank until you enter real current values.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function GoalsClient() {
  const [view, setView] = useState<GoalsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
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
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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

  if (fetchFailed || view == null) {
    // Retry cannot fix an expired session, so the failure decides its own action.
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page goals-page">
        <PageHeader
          breadcrumbs="Team / Goals"
          title="Goals"
          description="Measurable season objectives with progress from real current values."
        />
        <EmptyState
          soft
          title={failure ? failure.title : "Loading season goals…"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page goals-page">
        <PageHeader
          breadcrumbs="Team / Goals"
          title="Goals"
          description="Set measurable season objectives; progress fills in as your team logs work against them."
        />
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
        <NextActions orgId={view.orgId} goalCount={0} achieved={0} needsAttention={0} />
      </main>
    );
  }

  const hasGoals = view.evaluations.length > 0;
  const topTitle = view.summary.needsAttention[0]?.goal.title ?? view.evaluations[0]?.goal.title ?? null;

  return (
    <main className="module-page goals-page">
      <PageHeader
        breadcrumbs="Team / Goals"
        title="Goals"
        description={
          <>
            Set the measurable objectives that define a successful season — competition, technical, outreach, and
            business — and track progress from real current values only. Scorecard % stays blank until goals exist.
          </>
        }
      >
        <div className="goals-header-actions">
          {view.seasons.length > 0 ? (
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
          <Button as="a" variant="secondary" href={withOrgHref("/todos", orgId)}>
            Todos
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/practice", orgId)}>
            Practice
          </Button>
          <Button as="a" variant="secondary" href={withOrgHref("/team", orgId)}>
            Team hub
          </Button>
        </div>
      </PageHeader>

      {orgId ? <GoalsRelated orgId={orgId} /> : null}

      {error ? (
        <p className="goals-alert" role="alert">
          {error}
        </p>
      ) : null}

      <NextActions
        orgId={orgId}
        goalCount={view.summary.total}
        achieved={view.summary.achieved}
        needsAttention={view.summary.needsAttention.length}
        topTitle={topTitle}
      />

      <Scorecard view={view} />

      {view.summary.needsAttention.length > 0 ? <NeedsAttention view={view} /> : null}

      {!hasGoals ? (
        <EmptyState
          soft
          title="No season goals yet"
          description="Add a measurable target above (matches won, outreach hours, dollars raised, a yes/no milestone). Season progress stays blank until then."
        >
          <div className="goals-row-links">
            <a href={withOrgHref("/todos", orgId)}>Todos →</a>
            <a href={withOrgHref("/practice", orgId)}>Practice →</a>
            <a href={withOrgHref("/team", orgId)}>Team hub →</a>
          </div>
        </EmptyState>
      ) : null}

      <AddGoalForm busy={busy} mutate={mutate} />
      {hasGoals ? <GoalList view={view} busy={busy} mutate={mutate} /> : null}
    </main>
  );
}

function Scorecard({ view }: { view: LiveView }) {
  const s = view.summary;
  const hasGoals = s.total > 0;
  const attention = s.statusCounts.at_risk + s.statusCounts.missed;
  const tiles = [
    { label: "Goals", value: hasGoals ? String(s.total) : "—", tone: "" },
    {
      label: "Achieved",
      value: formatGoalsAchievedDisplay(s.achieved, s.total),
      tone: hasGoals && s.achieved === s.total ? "good" : "",
    },
    {
      label: "At risk / missed",
      value: hasGoals ? String(attention) : "—",
      tone: attention > 0 ? "warn" : "",
    },
    {
      label: "Season progress",
      value: formatGoalsProgressDisplay(s.weightedProgress, s.total),
      tone: "",
    },
  ];
  return (
    <Panel>
      <section className="goals-summary" aria-label="Season goals scorecard">
        {tiles.map((tile) => (
          <article key={tile.label} className={`goals-summary-tile${tile.tone ? ` ${tile.tone}` : ""}`}>
            <strong>{tile.value}</strong>
            <span>{tile.label}</span>
          </article>
        ))}
      </section>
      <div className="goals-progress-wrap">
        <div className={`goals-progress-bar${hasGoals ? "" : " empty"}`} aria-hidden="true">
          <i style={{ width: hasGoals ? `${Math.max(2, s.weightedProgress * 100)}%` : "0%" }} />
        </div>
        <small className="app-muted">
          {hasGoals
            ? "Priority-weighted progress across logged goals only"
            : "Season progress stays blank until you add a real goal"}
        </small>
      </div>
      {hasGoals && s.byCategory.length > 0 ? (
        <div className="goals-category-row">
          {s.byCategory.map((row) => (
            <span
              key={row.category}
              className="goals-badge"
              title={`${row.achieved}/${row.total} achieved from logged values`}
            >
              {goalCategoryLabel(row.category)}: {Math.round(row.avgProgress * 100)}%
            </span>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function NeedsAttention({ view }: { view: LiveView }) {
  return (
    <section className="goals-attention app-card soft-panel" aria-label="Goals needing attention">
      <h2>Needs attention</h2>
      <ul>
        {view.summary.needsAttention.map((evaluation) => (
          <li key={evaluation.goal.id}>
            <strong>{evaluation.goal.title}</strong>
            <span className="meta">
              <span className={`goals-badge ${evaluation.status}`}>{goalStatusLabel(evaluation.status)}</span>
              {" · "}
              {Math.round(evaluation.progress * 100)}%
              {evaluation.daysToDue != null
                ? evaluation.daysToDue < 0
                  ? ` · ${Math.abs(evaluation.daysToDue)}d overdue`
                  : ` · due in ${evaluation.daysToDue}d`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
      className="goals-panel"
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
    >
      <h2>Add goal</h2>
      <p>Current value starts at zero — progress only moves when someone updates it from real work.</p>
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
      <div className="goals-form-actions">
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>
          Add goal
        </Button>
      </div>
    </Panel>
  );
}

function GoalList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
  return (
    <section className="goals-list" aria-label="Season goals">
      {view.evaluations.map((evaluation) => (
        <GoalCard key={evaluation.goal.id} evaluation={evaluation} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function GoalCard({ evaluation, busy, mutate }: { evaluation: GoalEvaluation; busy: boolean; mutate: Mutate }) {
  const { goal, progress, status, daysToDue } = evaluation;
  return (
    <article className={`goals-row ${status}`}>
      <header className="goals-row-top">
        <div className="goals-row-title">
          <div className="goals-row-meta">
            <span className={`goals-badge ${status as GoalStatus}`}>{goalStatusLabel(status)}</span>
            <span>
              {goalCategoryLabel(goal.category)} · {goal.priority}
              {daysToDue != null
                ? daysToDue < 0
                  ? ` · ${Math.abs(daysToDue)}d overdue`
                  : ` · due in ${daysToDue}d`
                : ""}
            </span>
          </div>
          <strong>{goal.title}</strong>
        </div>
        <div className="goals-row-scores">
          <span className="goals-score">
            <em>Progress</em>
            <strong>{Math.round(progress * 100)}%</strong>
          </span>
          <small className="app-muted">{formatGoalValue(goal)}</small>
        </div>
      </header>

      <div className="goals-progress-bar" aria-hidden="true">
        <i style={{ width: `${Math.max(2, progress * 100)}%` }} />
      </div>

      <footer className="goals-row-actions">
        {goal.metricType === "binary" ? (
          <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "update-goal", goalId: goal.id, currentValue: goal.currentValue>= 1 ? 0 : 1 }) }>
            {goal.currentValue >= 1 ? "Mark not done" : "Mark done"}
          </Button>
        ) : (
          <label>
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
            />
            <span>
              / {goal.metricType === "currency" ? `$${goal.targetValue.toLocaleString()}` : goal.targetValue}
              {goal.metricType === "percent" ? "%" : goal.unit ? ` ${goal.unit}` : ""}
            </span>
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
    </article>
  );
}
