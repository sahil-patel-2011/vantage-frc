"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { HowToUseLink } from "../help/how-to-use-link";
import {
  GOAL_CATEGORIES,
  WORK_ITEM_STATUSES,
  currentSeasonYear,
  goalCategoryLabel,
  workItemStatusLabel,
  type SeasonPlanningWorkspaceView,
} from "../../lib/season-planning-workspace";
import {
  SEASON_PLANNING_RELATED_INCLUDE,
  classifySeasonPlanningShell,
  formatSeasonPlanningMetric,
  seasonPlanningNextActions,
  seasonPlanningRelatedLinks,
  seasonPlanningSetupSteps,
  seasonPlanningShellCopy,
  shouldShowSeasonPlanningSummaryTiles,
  type SeasonPlanningNextAction,
  type SeasonPlanningShellKind,
} from "../../lib/season-planning-workspace/season-planning-workspace-related";
import type { GoalCategory, SeasonGoal, WorkItemStatus } from "../../lib/season-planning-workspace/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./season-planning-workspace.css";

type LiveView = Extract<SeasonPlanningWorkspaceView, { status: "live" }>;
type EmptyView = Extract<SeasonPlanningWorkspaceView, { status: "empty" }>;

function statusTone(status: WorkItemStatus): BadgeTone {
  if (status === "done") return "good";
  if (status === "in_progress") return "info";
  if (status === "dropped") return "neutral";
  return "setup";
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = seasonPlanningRelatedLinks(orgId, {
    include: [...SEASON_PLANNING_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related season-plan-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: SeasonPlanningNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions season-plan-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Goals, Calendar, and Attendance — never DEMO completion %.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlanShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: SeasonPlanningShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = seasonPlanningNextActions({ orgId, shell });
  const copy = seasonPlanningShellCopy(shell);
  const teamHref = hubHref("/team", "season-planning-workspace", orgId);
  const steps = shell === "setup" ? seasonPlanningSetupSteps(orgId) : [];

  return (
    <main className="module-page season-plan-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Season Planning Workspace"}
          </>
        }
        title="Season Planning Workspace"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading season planning">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="season-plan-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Goals and Calendar — never DEMO completion %.</p>
          </header>
          <ul className="season-plan-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted season-plan-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <NextActionsPanel actions={actions} />
    </main>
  );
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
    <Panel className="season-plan-panel">
      <div className="season-plan-goal-head">
        <div>
          <h3 style={{ margin: 0 }}>{goal.title}</h3>
          <p className="app-muted season-plan-tip">
            {goalCategoryLabel(goal.category)}
            {goal.ownerName ? ` · Owner ${goal.ownerName}` : ""}
            {goal.targetDate ? ` · Target ${goal.targetDate}` : ""}
          </p>
        </div>
        <div className="season-plan-badges">
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

      <label className="app-muted season-plan-status-label">
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
        <ul className="season-plan-milestones">
          {goal.milestones.map((m) => (
            <li key={m.id}>
              <div className="season-plan-badges">
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const planId = view && view.status === "live" ? view.plan.id : null;
  const goalsTotal = view?.status === "live" ? view.progress.goalsTotal : 0;
  const milestonesTotal = view?.status === "live" ? view.progress.milestonesTotal : 0;

  const shell = classifySeasonPlanningShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
  });
  const shellCopy = seasonPlanningShellCopy(shell);
  const nextActions = seasonPlanningNextActions({
    orgId,
    shell,
    goalsTotal,
    milestonesTotal,
  });
  const relatedLinks = seasonPlanningRelatedLinks(orgId, {
    include: [...SEASON_PLANNING_RELATED_INCLUDE],
  });
  const teamHref = hubHref("/team", "season-planning-workspace", orgId);
  const showTiles = shouldShowSeasonPlanningSummaryTiles({ goalsTotal, milestonesTotal });

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

  if (shell === "loading") {
    return <PlanShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <PlanShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <PlanShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
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
        ) : null}
      </PlanShell>
    );
  }

  return (
    <main className="module-page season-plan-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Season Planning Workspace"}
          </>
        }
        title="Season Planning Workspace"
        description="Goals → milestones → owners with calendar sync hooks. Progress uses real attendance and build-task data — never DEMO completion %. Cross-check Season Goals, Calendar, and Attendance."
      >
        <div className="season-plan-header-actions">
          <HowToUseLink slug="alliance-season" />
          {view && "seasons" in view && view.seasons.length > 0 ? (
            <label className="app-muted season-plan-select">
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
            <a id="season-plan-ics" className="app-button secondary" href={icsHref}>
              Export milestones .ics
            </a>
          ) : null}
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p role="alert" className="telemetry-status">
          {error}
        </p>
      ) : null}

      <NextActionsPanel actions={nextActions} />

      {showTiles && view?.status === "live" ? (
        <section className="season-plan-stats" aria-label="Season Planning counts">
          <StatTile
            label="Goals done"
            value={`${formatSeasonPlanningMetric(view.progress.goalsDone, true)}/${formatSeasonPlanningMetric(view.progress.goalsTotal, true)}`}
          />
          <StatTile
            label="Milestones"
            value={
              view.progress.milestoneCompletionPct != null
                ? `${view.progress.milestoneCompletionPct}%`
                : "—"
            }
          />
          <StatTile
            label="Attendance events"
            value={formatSeasonPlanningMetric(view.progress.signals.attendanceEventCount, true)}
          />
        </section>
      ) : null}

      {shell === "empty" && view?.status === "empty" ? (
        <div className="season-plan-layout">
          <EmptyState
            soft
            badge="No plan"
            badgeTone="setup"
            title={(view as EmptyView).message}
            description={shellCopy.description}
          />
          <Panel
            id="season-plan-create"
            as="form"
            className="season-plan-panel"
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
      ) : view?.status === "live" ? (
        <div id="season-plan-goals" className="season-plan-layout">
          <Panel className="season-plan-panel">
            <h3 style={{ marginTop: 0 }}>{(view as LiveView).plan.title}</h3>
            <div className="season-plan-badges">
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
            id="season-plan-add-goal"
            as="form"
            className="season-plan-panel"
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
            <div className="season-plan-layout">
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
      ) : null}
    </main>
  );
}
