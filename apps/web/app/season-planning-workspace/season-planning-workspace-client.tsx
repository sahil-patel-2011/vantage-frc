"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  CardGridSkeleton,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  TextBlockSkeleton,
} from "../../components/ui";
import {
  GOAL_CATEGORIES,
  WORK_ITEM_STATUSES,
  currentSeasonYear,
  goalCategoryLabel,
  workItemStatusLabel,
  type SeasonPlanningWorkspaceView,
} from "../../lib/season-planning-workspace";
import type { GoalCategory, SeasonGoal, WorkItemStatus } from "../../lib/season-planning-workspace/types";

type LiveView = Extract<SeasonPlanningWorkspaceView, { status: "live" }>;
type EmptyView = Extract<SeasonPlanningWorkspaceView, { status: "empty" }>;

function statusTone(status: WorkItemStatus): BadgeTone {
  if (status === "done") return "good";
  if (status === "in_progress") return "info";
  if (status === "dropped") return "neutral";
  return "setup";
}

function GoalCard({
  goal,
  members,
  busy,
  mutate,
}: {
  goal: SeasonGoal;
  members: LiveView["members"];
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [milestoneDue, setMilestoneDue] = useState("");
  const [milestoneOwner, setMilestoneOwner] = useState("");

  return (
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div>
          <h3 style={{ margin: 0 }}>{goal.title}</h3>
          <p className="app-muted" style={{ margin: "4px 0 0" }}>
            {goalCategoryLabel(goal.category)}
            {goal.ownerName ? ` · Owner ${goal.ownerName}` : ""}
            {goal.targetDate ? ` · Target ${goal.targetDate}` : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Badge tone={statusTone(goal.status)}>{workItemStatusLabel(goal.status)}</Badge>
          {goal.milestoneTotal > 0 ? (
            <Badge tone="neutral">
              {goal.milestoneDone}/{goal.milestoneTotal} milestones
            </Badge>
          ) : (
            <Badge tone="setup">No milestones</Badge>
          )}
        </div>
      </div>

      <label className="app-muted" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
        Goal status
        <select
          value={goal.status}
          disabled={busy}
          onChange={(e) =>
            void mutate({ action: "set-goal-status", goalId: goal.id, status: e.target.value })
          }
        >
          {WORK_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {workItemStatusLabel(s)}
            </option>
          ))}
        </select>
      </label>

      {goal.milestones.length > 0 ? (
        <ul style={{ margin: "12px 0 0", paddingLeft: "1.1rem", display: "grid", gap: 6 }}>
          {goal.milestones.map((m) => (
            <li key={m.id}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <strong>{m.title}</strong>
                <Badge tone={statusTone(m.status)}>{workItemStatusLabel(m.status)}</Badge>
                {m.dueOn ? <span className="app-muted">Due {m.dueOn}</span> : null}
                {m.ownerName ? <span className="app-muted">{m.ownerName}</span> : null}
                {m.calendarEventUid ? <Badge tone="info">Calendar hook</Badge> : null}
                <select
                  value={m.status}
                  disabled={busy}
                  onChange={(e) =>
                    void mutate({
                      action: "set-milestone-status",
                      milestoneId: m.id,
                      status: e.target.value,
                    })
                  }
                >
                  {WORK_ITEM_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {workItemStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      <FormGrid>
        <FormRow label="New milestone">
          <input
            value={milestoneTitle}
            onChange={(e) => setMilestoneTitle(e.target.value)}
            placeholder="Prototype freeze"
            disabled={busy}
          />
        </FormRow>
        <FormRow label="Due">
          <input type="date" value={milestoneDue} onChange={(e) => setMilestoneDue(e.target.value)} disabled={busy} />
        </FormRow>
        <FormRow label="Owner">
          <select value={milestoneOwner} onChange={(e) => setMilestoneOwner(e.target.value)} disabled={busy}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name ?? m.email ?? m.userId}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <Button
        type="button"
        size="sm"
        disabled={busy || !milestoneTitle.trim()}
        onClick={() => {
          void mutate({
            action: "create-milestone",
            goalId: goal.id,
            title: milestoneTitle.trim(),
            dueOn: milestoneDue || null,
            ownerUserId: milestoneOwner || null,
          }).then(() => {
            setMilestoneTitle("");
            setMilestoneDue("");
            setMilestoneOwner("");
          });
        }}
      >
        Add milestone
      </Button>
    </Panel>
  );
}

export default function SeasonPlanningWorkspaceClient() {
  const [view, setView] = useState<SeasonPlanningWorkspaceView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [planTitle, setPlanTitle] = useState("");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalCategory, setGoalCategory] = useState<GoalCategory>("build");
  const [goalOwner, setGoalOwner] = useState("");
  const [goalTarget, setGoalTarget] = useState("");

  const orgId = view && "orgId" in view ? view.orgId : null;
  const planId = view && view.status === "live" ? view.plan.id : null;

  const load = useCallback((seasonOverride?: number, planOverride?: string | null) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const planQuery = planOverride ?? params.get("planId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    if (planQuery) query.set("planId", planQuery);
    void fetch(`/api/season-planning-workspace${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SeasonPlanningWorkspaceView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        if (!planTitle && data.status === "empty") {
          setPlanTitle(`${data.seasonYear} Season Plan`);
        }
      })
      .catch(() => setFetchFailed(true));
  }, [planTitle]);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/season-planning-workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, planId, ...payload }),
        });
        const data = (await response.json()) as SeasonPlanningWorkspaceView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? String(data.error) : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, planId, busy],
  );

  const icsHref = useMemo(() => {
    if (!orgId || !planId) return null;
    const query = new URLSearchParams({ orgId, planId, format: "ics" });
    if (season) query.set("season", String(season));
    return `/api/season-planning-workspace?${query.toString()}`;
  }, [orgId, planId, season]);

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={<>Team / Season Planning Workspace</>}
        title="Season Planning Workspace"
        description="Goals → milestones → owners with calendar sync hooks. Progress uses real attendance and build-task data — never DEMO completion %."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {view && "seasons" in view && view.seasons.length > 0 ? (
            <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              Season
              <select
                value={season ?? view.seasonYear}
                onChange={(e) => {
                  const next = Number(e.target.value);
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
          {icsHref ? (
            <a className="app-button secondary" href={icsHref}>
              Export milestones .ics
            </a>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p role="alert" style={{ color: "var(--app-danger, #c0392b)" }}>
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <ErrorState
          title="Could not load Season Planning Workspace"
          message="A network or server issue prevented loading. Try again."
          onRetry={() => load()}
        />
      ) : view == null ? (
        <div aria-busy="true" aria-label="Loading season planning" style={{ display: "grid", gap: 16 }}>
          <TextBlockSkeleton lines={2} />
          <CardGridSkeleton cols={2} rows={2} />
        </div>
      ) : view.status === "setup_required" ? (
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
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
      ) : view.status === "empty" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <EmptyState
            soft
            badge="No plan"
            badgeTone="setup"
            title={(view as EmptyView).message}
            description="Create a plan, then add goals and dated milestones. Attendance and build-task signals appear once those modules have real rows."
          />
          <Panel
            as="form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate({
                action: "create-plan",
                title: planTitle.trim() || `${season ?? currentSeasonYear()} Season Plan`,
              });
            }}
          >
            <FormRow label="Plan title">
              <input value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} disabled={busy} />
            </FormRow>
            <Button type="submit" disabled={busy}>
              Create season plan
            </Button>
          </Panel>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <Panel>
            <h3 style={{ marginTop: 0 }}>{(view as LiveView).plan.title}</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Badge tone="neutral">
                Goals {(view as LiveView).progress.goalsDone}/{(view as LiveView).progress.goalsTotal}
              </Badge>
              {(view as LiveView).progress.milestoneCompletionPct != null ? (
                <Badge tone="good">
                  Milestones {(view as LiveView).progress.milestoneCompletionPct}% done
                </Badge>
              ) : (
                <Badge tone="setup">Milestones — no dated work yet</Badge>
              )}
              <Badge tone="info">
                Attendance {(view as LiveView).progress.signals.attendanceEventCount} events ·{" "}
                {(view as LiveView).progress.signals.attendanceEntryCount} check-ins
              </Badge>
              {(view as LiveView).progress.signals.buildCompletionPct != null ? (
                <Badge tone="good">
                  Build tasks {(view as LiveView).progress.signals.buildCompletionPct}% done (
                  {(view as LiveView).progress.signals.buildTaskDone}/
                  {(view as LiveView).progress.signals.buildTaskTotal})
                </Badge>
              ) : (
                <Badge tone="setup">Build tasks — none logged this season</Badge>
              )}
            </div>
          </Panel>

          <Panel
            as="form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!goalTitle.trim()) return;
              void mutate({
                action: "create-goal",
                title: goalTitle.trim(),
                category: goalCategory,
                ownerUserId: goalOwner || null,
                targetDate: goalTarget || null,
              }).then(() => {
                setGoalTitle("");
                setGoalTarget("");
                setGoalOwner("");
              });
            }}
          >
            <h3 style={{ marginTop: 0 }}>Add goal</h3>
            <FormGrid>
              <FormRow label="Title">
                <input value={goalTitle} onChange={(e) => setGoalTitle(e.target.value)} disabled={busy} />
              </FormRow>
              <FormRow label="Category">
                <select
                  value={goalCategory}
                  onChange={(e) => setGoalCategory(e.target.value as GoalCategory)}
                  disabled={busy}
                >
                  {GOAL_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {goalCategoryLabel(c)}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Owner">
                <select value={goalOwner} onChange={(e) => setGoalOwner(e.target.value)} disabled={busy}>
                  <option value="">Unassigned</option>
                  {(view as LiveView).members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name ?? m.email ?? m.userId}
                    </option>
                  ))}
                </select>
              </FormRow>
              <FormRow label="Target date">
                <input type="date" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} disabled={busy} />
              </FormRow>
            </FormGrid>
            <Button type="submit" disabled={busy || !goalTitle.trim()}>
              Add goal
            </Button>
          </Panel>

          {(view as LiveView).goals.length === 0 ? (
            <EmptyState
              soft
              badge="No goals"
              badgeTone="setup"
              title="Add your first season goal"
              description="Break it into milestones with owners and due dates. Progress % stays blank until milestones or build tasks exist."
            />
          ) : (
            <div style={{ display: "grid", gap: 16 }}>
              {(view as LiveView).goals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  members={(view as LiveView).members}
                  busy={busy}
                  mutate={mutate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
