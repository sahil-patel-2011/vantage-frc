import type { PoolClient } from "@neondatabase/serverless";
import { buildCalendar, type CalendarIcsEvent } from "../calendar-ics";
import { hubHref } from "../nav/hubs";
import {
  computeBuildCompletionPct,
  computeSeasonPlanProgress,
  currentSeasonYear,
} from ".";
import type {
  GoalCategory,
  PlanStatus,
  SeasonGoal,
  SeasonMember,
  SeasonMilestone,
  SeasonPlanProgress,
  SeasonPlanSetupStep,
  SeasonPlanSummary,
  WorkItemStatus,
} from "./types";

export type SeasonPlanningWorkspaceView =
  | {
      status: "setup_required";
      message: string;
      steps: SeasonPlanSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "empty";
      message: string;
      steps: SeasonPlanSetupStep[];
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      members: SeasonMember[];
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      plan: SeasonPlanSummary & { notes: string };
      plans: SeasonPlanSummary[];
      goals: SeasonGoal[];
      progress: SeasonPlanProgress;
      members: SeasonMember[];
      computedAt: string;
    };

type PlanRow = {
  id: string;
  title: string;
  status: PlanStatus;
  notes: string;
  seasonYear: number;
  updatedAt: string;
};

type GoalRow = {
  id: string;
  title: string;
  category: GoalCategory;
  ownerUserId: string | null;
  ownerName: string | null;
  targetDate: string | null;
  status: WorkItemStatus;
  sortOrder: number;
};

type MilestoneRow = {
  id: string;
  goalId: string;
  title: string;
  dueOn: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  status: WorkItemStatus;
  calendarEventUid: string | null;
  sortOrder: number;
};

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const result = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return result.rows[0] ?? null;
}

function setupSteps(orgId: string | null): SeasonPlanSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose which FRC team you are working as.",
      href: "/workspace",
    },
    {
      id: "plan",
      label: "Create a season plan",
      detail: "Goals → milestones → owners for this year",
      href: orgId ? `/season-planning-workspace?orgId=${encodeURIComponent(orgId)}` : "/season-planning-workspace",
    },
    {
      id: "attendance",
      label: "Log attendance",
      detail: "Progress signals come from real attendance events",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "tasks",
      label: "Track build tasks",
      detail: "Build completion % only when tasks exist",
      href: hubHref("/team", "task-board", orgId),
    },
  ];
}

async function loadMembers(client: PoolClient, orgId: string): Promise<SeasonMember[]> {
  const result = await client.query<SeasonMember>(
    `SELECT m.user_id AS "userId", u.name, u.email
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1
     ORDER BY u.name NULLS LAST, u.email
     LIMIT 80`,
    [orgId],
  );
  return result.rows;
}

async function loadSeasonSignals(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<SeasonPlanProgress["signals"]> {
  const [attendance, tasks] = await Promise.all([
    client.query<{ eventCount: string; entryCount: string }>(
      `SELECT
         (SELECT COUNT(*)::text FROM attendance_events WHERE org_id = $1 AND season_year = $2) AS "eventCount",
         (SELECT COUNT(*)::text FROM attendance_entries ae
          JOIN attendance_events ev ON ev.id = ae.event_id
          WHERE ae.org_id = $1 AND ev.season_year = $2) AS "entryCount"`,
      [orgId, seasonYear],
    ),
    client.query<{ total: string; done: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'done')::text AS done
       FROM build_tasks
       WHERE org_id = $1 AND season_year = $2 AND status != 'archived'`,
      [orgId, seasonYear],
    ),
  ]);
  const buildTaskTotal = Number(tasks.rows[0]?.total) || 0;
  const buildTaskDone = Number(tasks.rows[0]?.done) || 0;
  return {
    attendanceEventCount: Number(attendance.rows[0]?.eventCount) || 0,
    attendanceEntryCount: Number(attendance.rows[0]?.entryCount) || 0,
    buildTaskTotal,
    buildTaskDone,
    buildCompletionPct: computeBuildCompletionPct(buildTaskDone, buildTaskTotal),
  };
}

export async function computeSeasonPlanningWorkspaceView(
  client: PoolClient,
  input: {
    userId: string;
    requestedOrg: string | null;
    seasonYear?: number | null;
    planId?: string | null;
  },
): Promise<SeasonPlanningWorkspaceView> {
  const seasonYear =
    input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to plan the season.",
      steps: setupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const [planResult, seasonResult, members] = await Promise.all([
    client.query<PlanRow>(
      `SELECT id, title, status, notes, season_year AS "seasonYear", updated_at::text AS "updatedAt"
       FROM season_planning_workspace_plans
       WHERE org_id = $1 AND season_year = $2
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear"
       FROM season_planning_workspace_plans WHERE org_id = $1
       ORDER BY season_year DESC`,
      [org.orgId],
    ),
    loadMembers(client, org.orgId),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  if (planResult.rows.length === 0) {
    return {
      status: "empty",
      message: `No season plan for ${seasonYear} yet. Create one to add goals, milestones, and owners.`,
      steps: setupSteps(org.orgId),
      orgId: org.orgId,
      teamNumber: org.teamNumber,
      seasonYear,
      seasons,
      members,
    };
  }

  const plans: SeasonPlanSummary[] = planResult.rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    seasonYear: row.seasonYear,
    updatedAt: row.updatedAt,
  }));

  const active =
    (input.planId && planResult.rows.find((p) => p.id === input.planId)) || planResult.rows[0]!;

  const [goalResult, milestoneResult, signals] = await Promise.all([
    client.query<GoalRow>(
      `SELECT g.id, g.title, g.category, g.owner_user_id::text AS "ownerUserId", u.name AS "ownerName",
              g.target_date::text AS "targetDate", g.status, g.sort_order AS "sortOrder"
       FROM season_planning_workspace_goals g
       LEFT JOIN users u ON u.id = g.owner_user_id
       WHERE g.org_id = $1 AND g.plan_id = $2::uuid
       ORDER BY g.sort_order, g.created_at`,
      [org.orgId, active.id],
    ),
    client.query<MilestoneRow>(
      `SELECT m.id, m.goal_id AS "goalId", m.title, m.due_on::text AS "dueOn",
              m.owner_user_id::text AS "ownerUserId", u.name AS "ownerName",
              m.status, m.calendar_event_uid AS "calendarEventUid", m.sort_order AS "sortOrder"
       FROM season_planning_workspace_milestones m
       LEFT JOIN users u ON u.id = m.owner_user_id
       WHERE m.org_id = $1 AND m.plan_id = $2::uuid
       ORDER BY m.sort_order, m.due_on NULLS LAST, m.created_at`,
      [org.orgId, active.id],
    ),
    loadSeasonSignals(client, org.orgId, seasonYear),
  ]);

  const milestonesByGoal = new Map<string, SeasonMilestone[]>();
  for (const row of milestoneResult.rows) {
    const list = milestonesByGoal.get(row.goalId) ?? [];
    list.push({
      id: row.id,
      goalId: row.goalId,
      title: row.title,
      dueOn: row.dueOn,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      status: row.status,
      calendarEventUid: row.calendarEventUid,
      sortOrder: row.sortOrder,
    });
    milestonesByGoal.set(row.goalId, list);
  }

  const goals: SeasonGoal[] = goalResult.rows.map((row) => {
    const milestones = milestonesByGoal.get(row.id) ?? [];
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      ownerUserId: row.ownerUserId,
      ownerName: row.ownerName,
      targetDate: row.targetDate,
      status: row.status,
      sortOrder: row.sortOrder,
      milestones,
      milestoneDone: milestones.filter((m) => m.status === "done").length,
      milestoneTotal: milestones.length,
    };
  });

  const milestonesTotal = milestoneResult.rows.length;
  const milestonesDone = milestoneResult.rows.filter((m) => m.status === "done").length;
  const progress = computeSeasonPlanProgress({
    goalsTotal: goals.length,
    goalsDone: goals.filter((g) => g.status === "done").length,
    milestonesTotal,
    milestonesDone,
    signals,
  });

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    plan: {
      id: active.id,
      title: active.title,
      status: active.status,
      seasonYear: active.seasonYear,
      updatedAt: active.updatedAt,
      notes: active.notes,
    },
    plans,
    goals,
    progress,
    members,
    computedAt: new Date().toISOString(),
  };
}

export async function createSeasonPlan(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    title: string;
    notes?: string | null;
  },
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO season_planning_workspace_plans (org_id, season_year, title, notes, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [input.orgId, input.seasonYear, input.title, input.notes ?? "", input.userId],
  );
  return inserted.rows[0]!.id;
}

export async function createSeasonGoal(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    planId: string;
    title: string;
    category: GoalCategory;
    ownerUserId?: string | null;
    targetDate?: string | null;
  },
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO season_planning_workspace_goals (
       org_id, plan_id, title, category, owner_user_id, target_date, created_by
     ) VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6::date, $7)
     RETURNING id`,
    [
      input.orgId,
      input.planId,
      input.title,
      input.category,
      input.ownerUserId ?? null,
      input.targetDate ?? null,
      input.userId,
    ],
  );
  await client.query(
    `UPDATE season_planning_workspace_plans SET updated_at = now() WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.planId],
  );
  return inserted.rows[0]!.id;
}

export async function updateSeasonGoalStatus(
  client: PoolClient,
  input: { orgId: string; goalId: string; status: WorkItemStatus },
): Promise<void> {
  await client.query(
    `UPDATE season_planning_workspace_goals
     SET status = $3, updated_at = now()
     WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.goalId, input.status],
  );
}

export async function createSeasonMilestone(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    planId: string;
    goalId: string;
    title: string;
    dueOn?: string | null;
    ownerUserId?: string | null;
    calendarEventUid?: string | null;
  },
): Promise<string> {
  const uid =
    input.calendarEventUid?.trim() ||
    `vantage-spw-${input.goalId.slice(0, 8)}-${Date.now().toString(36)}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO season_planning_workspace_milestones (
       org_id, plan_id, goal_id, title, due_on, owner_user_id, calendar_event_uid, created_by
     ) VALUES ($1, $2::uuid, $3::uuid, $4, $5::date, $6::uuid, $7, $8)
     RETURNING id`,
    [
      input.orgId,
      input.planId,
      input.goalId,
      input.title,
      input.dueOn ?? null,
      input.ownerUserId ?? null,
      uid,
      input.userId,
    ],
  );
  await client.query(
    `UPDATE season_planning_workspace_plans SET updated_at = now() WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.planId],
  );
  return inserted.rows[0]!.id;
}

export async function updateSeasonMilestoneStatus(
  client: PoolClient,
  input: { orgId: string; milestoneId: string; status: WorkItemStatus },
): Promise<void> {
  await client.query(
    `UPDATE season_planning_workspace_milestones
     SET status = $3, updated_at = now()
     WHERE org_id = $1 AND id = $2::uuid`,
    [input.orgId, input.milestoneId, input.status],
  );
}

export async function buildSeasonPlanningIcs(
  client: PoolClient,
  input: {
    orgId: string;
    planId: string;
    teamNumber: number | null;
    orgName: string | null;
    seasonYear: number;
  },
): Promise<string> {
  const milestones = await client.query<{
    id: string;
    title: string;
    dueOn: string | null;
    calendarEventUid: string | null;
    goalTitle: string;
    updatedAt: string;
  }>(
    `SELECT m.id, m.title, m.due_on::text AS "dueOn", m.calendar_event_uid AS "calendarEventUid",
            g.title AS "goalTitle", m.updated_at::text AS "updatedAt"
     FROM season_planning_workspace_milestones m
     JOIN season_planning_workspace_goals g ON g.id = m.goal_id
     WHERE m.org_id = $1 AND m.plan_id = $2::uuid AND m.due_on IS NOT NULL
       AND m.status != 'dropped'
     ORDER BY m.due_on`,
    [input.orgId, input.planId],
  );

  const events: CalendarIcsEvent[] = milestones.rows
    .filter((row) => row.dueOn)
    .map((row) => ({
      id: row.calendarEventUid || row.id,
      title: `${row.title} (${row.goalTitle})`,
      kind: "season-milestone",
      location: "",
      description: `Season planning milestone · ${input.seasonYear}`,
      startsAt: row.dueOn!,
      endsAt: null,
      updatedAt: row.updatedAt,
      allDay: true,
    }));

  return buildCalendar(
    {
      orgName: input.orgName,
      teamNumber: input.teamNumber,
      scope: "org",
      events,
    },
    { domain: "vantagefrc.com" },
  );
}
