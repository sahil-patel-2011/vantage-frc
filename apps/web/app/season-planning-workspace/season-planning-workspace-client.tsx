"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
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
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./season-planning-workspace.css";

type LiveView = Extract<SeasonPlanningWorkspaceView, { status: "live" }>;
type EmptyView = Extract<SeasonPlanningWorkspaceView, { status: "empty" }>;

function isSeasonPlanningWorkspaceView(value: unknown): value is SeasonPlanningWorkspaceView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "empty" || status === "live";
}

function seasonPlanningCacheOrg(data: SeasonPlanningWorkspaceView, orgHint: string): string {
  if ("orgId" in data && typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistSeasonPlanningSnapshot(
  orgHint: string,
  seasonHint: string,
  data: SeasonPlanningWorkspaceView,
): Promise<void> {
  const cacheOrg = seasonPlanningCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("season-planning-workspace", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("season-planning-workspace", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Season plan already painted; IndexedDB is best-effort.
  }
}

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
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
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
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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
  const teamHref = hubWorkbenchHref("team", "season-planning-workspace", orgId);
  const setup = shell === "setup" ? seasonPlanningSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page season-plan-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Season plan"}
          </>
        }
        title="Season plan"
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
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<SeasonPlanningWorkspaceView | null>(null);
  viewRef.current = view;

  const load = useCallback((seasonOverride?: number, planOverride?: string | null) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      const planQuery = planOverride ?? params.get("planId");
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<SeasonPlanningWorkspaceView>(
          "season-planning-workspace",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isSeasonPlanningWorkspaceView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
          if (!planTitle && cached.data.status === "empty") {
            setPlanTitle(`${cached.data.seasonYear} Season Plan`);
          }
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      if (planQuery) query.set("planId", planQuery);
      try {
        const response = await fetch(
          `/api/season-planning-workspace${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as SeasonPlanningWorkspaceView | { error?: string };
        if (!response.ok || !isSeasonPlanningWorkspaceView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Season plan. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        if (!planTitle && data.status === "empty") {
          setPlanTitle(`${data.seasonYear} Season Plan`);
        }
        setFromCache(false);
        setCachedAt(null);
        await persistSeasonPlanningSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Season plan. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
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
  const teamHref = hubWorkbenchHref("team", "season-planning-workspace", orgId);
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
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as SeasonPlanningWorkspaceView | { error?: string };
        if (!response.ok || !isSeasonPlanningWorkspaceView(data)) {
          setError("error" in data && data.error ? String(data.error) : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistSeasonPlanningSnapshot(orgId, season != null ? String(season) : "", data);
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
    return (
      <PlanShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Season plan" fromCache={fromCache} cachedAt={cachedAt} />
      </PlanShell>
    );
  }

  if (shell === "error") {
    return (
      <PlanShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Season plan" fromCache={fromCache} cachedAt={cachedAt} />
      </PlanShell>
    );
  }

  if (shell === "setup") {
    return (
      <PlanShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Season plan" fromCache={fromCache} cachedAt={cachedAt} />
      </PlanShell>
    );
  }

  return (
    <main className="module-page season-plan-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Season plan"}
          </>
        }
        title="Season plan"
        description="Goals → milestones → owners with calendar sync hooks. Progress uses real attendance and build-task data. Cross-check Goals, Calendar, and Attendance."
      >
        <div className="season-plan-header-actions">
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
            <Button as="a" variant="secondary" id="season-plan-ics" href={icsHref}>
              Export milestones .ics
            </Button>
          ) : null}
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Season plan" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p role="alert" className="telemetry-status">
          {error}
        </p>
      ) : null}

      <NextActionsPanel actions={nextActions} />

      {showTiles && view?.status === "live" ? (
        <section className="season-plan-stats" aria-label="Season plan counts">
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
