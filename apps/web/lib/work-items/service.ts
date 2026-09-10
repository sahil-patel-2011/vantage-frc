/**
 * The DB side of the canonical work-item adapter.
 *
 * Reads `team_todos`, `build_tasks` and `season_planning_workspace_milestones` through the caller's
 * `withRls` client and returns one list in the shared shape. No new tables, no writes to any table
 * that the owning feature does not already write.
 *
 * Every table read is individually tolerant of being absent: these three features shipped at
 * different times and a team that has run only some migrations should still see the trackers
 * it does have, not a hard failure.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { RosterMember } from "../presence/match-names";
import {
  asOfUtcDate,
  fromBuildTask,
  fromMilestone,
  fromTodo,
  sortWorkItems,
  summarizeWorkItems,
  type WorkItemSummary,
  workItemCalendarEntries,
  workloadByMember,
} from "./canonical";
import type { WorkItem, WorkItemCalendarEntry } from "./types";

export type WorkItemsSetupStep = { id: string; label: string; detail: string; href: string };

export type WorkItemsView =
  | {
      status: "setup_required";
      message: string;
      steps: WorkItemsSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      currentUserId: string;
      asOf: string;
      items: WorkItem[];
      mine: WorkItem[];
      summary: WorkItemSummary;
      calendar: WorkItemCalendarEntry[];
      workload: Array<{ userId: string; name: string; open: number; overdue: number; blocked: number }>;
      computedAt: string;
    };

export async function loadRoster(client: PoolClient, orgId: string): Promise<RosterMember[]> {
  const rows = await client.query<{ userId: string; name: string | null }>(
    `SELECT m.user_id::text AS "userId", COALESCE(NULLIF(trim(u.name), ''), u.email) AS name
     FROM memberships m
     INNER JOIN users u ON u.id = m.user_id
     WHERE m.org_id = $1::uuid
     ORDER BY lower(COALESCE(u.name, u.email))`,
    [orgId],
  );
  return rows.rows;
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string } | null> {
  const row = await client.query<{ orgId: string }>(
    `SELECT m.org_id AS "orgId"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1::uuid
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return row.rows[0] ?? null;
}

async function loadTodoItems(
  client: PoolClient,
  orgId: string,
  asOf: string,
): Promise<WorkItem[]> {
  try {
    const rows = await client.query<Parameters<typeof fromTodo>[0]>(
      `SELECT t.id::text,
              t.title,
              t.status::text AS status,
              t.due_on::text AS "dueOn",
              t.assignee_user_id::text AS "assigneeUserId",
              a.name AS "assigneeName",
              t.subteam_id::text AS "subteamId",
              s.name AS "subteamName",
              t.created_at::text AS "createdAt",
              t.completed_at::text AS "completedAt"
       FROM team_todos t
       LEFT JOIN users a ON a.id = t.assignee_user_id
       LEFT JOIN team_subteams s ON s.id = t.subteam_id AND s.org_id = t.org_id
       WHERE t.org_id = $1::uuid`,
      [orgId],
    );
    return rows.rows.map((row) => fromTodo(row, orgId, asOf));
  } catch {
    return [];
  }
}

async function loadBuildTaskItems(
  client: PoolClient,
  orgId: string,
  asOf: string,
  roster: RosterMember[],
  seasonYear: number | null,
): Promise<WorkItem[]> {
  try {
    const rows = await client.query<{
      id: string;
      title: string;
      status: string;
      dueOn: string | null;
      assignees: string[] | null;
      subsystem: string | null;
      createdAt: string | null;
      doneAt: string | null;
    }>(
      `SELECT t.id::text,
              t.title,
              t.status::text AS status,
              t.due_on::text AS "dueOn",
              COALESCE(
                array_agg(a.assignee ORDER BY a.created_at) FILTER (WHERE a.assignee IS NOT NULL),
                '{}'
              ) AS assignees,
              t.subsystem,
              t.created_at::text AS "createdAt",
              t.done_at::text AS "doneAt"
       FROM build_tasks t
       LEFT JOIN build_task_assignees a ON a.task_id = t.id AND a.org_id = t.org_id
       WHERE t.org_id = $1::uuid
         AND ($2::int IS NULL OR t.season_year = $2::int)
       GROUP BY t.id`,
      [orgId, seasonYear],
    );
    return rows.rows.map((row) =>
      fromBuildTask({ ...row, assignees: row.assignees ?? [] }, orgId, asOf, roster),
    );
  } catch {
    return [];
  }
}

async function loadMilestoneItems(
  client: PoolClient,
  orgId: string,
  asOf: string,
): Promise<WorkItem[]> {
  try {
    const rows = await client.query<Parameters<typeof fromMilestone>[0]>(
      `SELECT m.id::text,
              m.title,
              m.status::text AS status,
              m.due_on::text AS "dueOn",
              m.owner_user_id::text AS "ownerUserId",
              u.name AS "ownerName",
              g.category::text AS category,
              m.created_at::text AS "createdAt"
       FROM season_planning_workspace_milestones m
       LEFT JOIN users u ON u.id = m.owner_user_id
       LEFT JOIN season_planning_workspace_goals g ON g.id = m.goal_id AND g.org_id = m.org_id
       WHERE m.org_id = $1::uuid`,
      [orgId],
    );
    return rows.rows.map((row) => fromMilestone(row, orgId, asOf));
  } catch {
    return [];
  }
}

export async function loadWorkItems(
  client: PoolClient,
  input: { orgId: string; asOf?: string; seasonYear?: number | null; roster?: RosterMember[] },
): Promise<{ items: WorkItem[]; roster: RosterMember[]; asOf: string }> {
  const asOf = input.asOf ?? asOfUtcDate();
  const roster = input.roster ?? (await loadRoster(client, input.orgId));
  const [todos, tasks, milestones] = await Promise.all([
    loadTodoItems(client, input.orgId, asOf),
    loadBuildTaskItems(client, input.orgId, asOf, roster, input.seasonYear ?? null),
    loadMilestoneItems(client, input.orgId, asOf),
  ]);
  return { items: sortWorkItems([...todos, ...tasks, ...milestones]), roster, asOf };
}

export async function computeWorkItemsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<WorkItemsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to see todos, build tasks, and season milestones together.",
      steps: [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick which FRC team you are working as.",
          href: "/workspace",
        },
      ],
      orgId: null,
    };
  }

  const { items, roster, asOf } = await loadWorkItems(client, {
    orgId: org.orgId,
    seasonYear: input.seasonYear ?? null,
  });

  return {
    status: "live",
    orgId: org.orgId,
    currentUserId: input.userId,
    asOf,
    items,
    mine: items.filter((item) => item.owners.some((owner) => owner.userId === input.userId)),
    summary: summarizeWorkItems(items),
    calendar: workItemCalendarEntries(items),
    workload: workloadByMember(
      roster.map((member) => ({ userId: member.userId, name: member.name ?? "Member" })),
      items,
    ),
    computedAt: new Date().toISOString(),
  };
}
