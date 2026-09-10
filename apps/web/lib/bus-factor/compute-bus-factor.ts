import type { PoolClient } from "@neondatabase/serverless";
import { BUS_FACTOR_AREAS, summarizeBusFactor } from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { BusFactorArea, BusFactorSummary, WorkloadEntry } from "./types";

export { BUS_FACTOR_AREAS };

export type BusFactorSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO risk metrics. */
function setupSteps(orgId: string | null): BusFactorSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open Bus-Factor.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Presence stays blank until real check-ins exist.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "hours-self-view",
      label: "Open My Hours",
      detail: "Clocked hours stay blank until members log shop time.",
      href: hubHref("/team", "hours-self-view", orgId),
    },
  ];
}

export type BusFactorView =
  | {
      status: "setup_required";
      message: string;
      steps: BusFactorSetupStep[];
      orgId: string | null;
      windowWeeks: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      windowWeeks: number;
      entries: WorkloadEntry[];
      members: Array<{ userId: string; name: string }>;
      summary: BusFactorSummary;
      /**
       * Grounding: actual clocked build hours per member over the same window, pulled from the
       * Build Hours module (`hour_logs`). Lets the view corroborate self-reported workload against
       * real shop time. Empty when no hours are logged — never fabricated.
       */
      actualBuildHours: Array<{ userId: string; name: string; hours: number }>;
      computedAt: string;
    };

export const DEFAULT_WINDOW_WEEKS = 6;

function windowWeeksFrom(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 52
    ? Math.round(value)
    : DEFAULT_WINDOW_WEEKS;
}

type EntryRow = {
  id: string;
  memberUserId: string;
  memberName: string | null;
  area: BusFactorArea;
  weekStart: string;
  hoursLogged: string | number;
  tasksOwned: number;
  soleKnowledgeCount: number;
};

function mapEntry(row: EntryRow): WorkloadEntry {
  return {
    id: row.id,
    memberUserId: row.memberUserId,
    memberName: row.memberName ?? "Unknown member",
    area: row.area,
    weekStart: row.weekStart,
    hoursLogged: Number(row.hoursLogged) || 0,
    tasksOwned: Number(row.tasksOwned) || 0,
    soleKnowledgeCount: Number(row.soleKnowledgeCount) || 0,
  };
}

async function resolveOrg(
  client: PoolClient,
  userId: string,
  requestedOrg: string | null,
): Promise<{ orgId: string; teamNumber: number | null } | null> {
  const membership = await client.query<{ orgId: string; teamNumber: number | null }>(
    `SELECT m.org_id AS "orgId", o.team_number AS "teamNumber"
     FROM memberships m
     JOIN organizations o ON o.id = m.org_id
     WHERE m.user_id = $1
       AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
     LIMIT 1`,
    [userId, requestedOrg],
  );
  return membership.rows[0] ?? null;
}

export async function computeBusFactorView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; windowWeeks?: number | null },
): Promise<BusFactorView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const windowWeeks = windowWeeksFrom(input.windowWeeks);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to see burnout / bus-factor risk.",
      steps: setupSteps(null),
      orgId: null,
      windowWeeks,
    };
  }

  const [entryResult, memberResult, actualHoursResult] = await Promise.all([
    client.query<EntryRow>(
      `SELECT e.id, e.member_user_id AS "memberUserId", u.name AS "memberName", e.area,
              e.week_start::text AS "weekStart", e.hours_logged AS "hoursLogged",
              e.tasks_owned AS "tasksOwned", e.sole_knowledge_count AS "soleKnowledgeCount"
       FROM bus_factor_workload_entries e
       LEFT JOIN users u ON u.id = e.member_user_id
       WHERE e.org_id = $1 AND e.week_start >= (CURRENT_DATE - ($2::int * 7))
       ORDER BY e.week_start DESC, e.created_at DESC`,
      [org.orgId, windowWeeks],
    ),
    client.query<{ userId: string; name: string }>(
      `SELECT m.user_id::text AS "userId", COALESCE(NULLIF(trim(u.name), ''), u.email) AS name
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 ORDER BY name`,
      [org.orgId],
    ),
    // Grounding: real clocked build hours per member over the same window (Build Hours module).
    client.query<{ userId: string; name: string; hours: string | number }>(
      `SELECT hl.user_id::text AS "userId",
              COALESCE(NULLIF(trim(u.name), ''), u.email) AS name,
              COALESCE(SUM(EXTRACT(EPOCH FROM (hl.clock_out - hl.clock_in)) / 3600.0), 0) AS "hours"
       FROM hour_logs hl JOIN users u ON u.id = hl.user_id
       WHERE hl.org_id = $1 AND hl.clock_out IS NOT NULL
         AND hl.clock_in >= (CURRENT_DATE - ($2::int * 7))
       GROUP BY hl.user_id, u.name, u.email
       HAVING SUM(EXTRACT(EPOCH FROM (hl.clock_out - hl.clock_in)) / 3600.0) > 0
       ORDER BY "hours" DESC`,
      [org.orgId, windowWeeks],
    ),
  ]);

  const entries = entryResult.rows.map(mapEntry);
  const summary = summarizeBusFactor(entries);
  const actualBuildHours = actualHoursResult.rows.map((r) => ({
    userId: r.userId,
    name: r.name ?? "Unknown member",
    hours: Math.round((Number(r.hours) || 0) * 10) / 10,
  }));

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    windowWeeks,
    entries,
    members: memberResult.rows,
    summary,
    actualBuildHours,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logWorkloadEntry(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    memberUserId: string;
    area: BusFactorArea;
    weekStart: string;
    hoursLogged: number;
    tasksOwned: number;
    soleKnowledgeCount: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO bus_factor_workload_entries (
       org_id, member_user_id, area, week_start, hours_logged, tasks_owned, sole_knowledge_count, logged_by
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.memberUserId,
      input.area,
      input.weekStart,
      Math.max(0, input.hoursLogged),
      Math.max(0, Math.round(input.tasksOwned)),
      Math.max(0, Math.round(input.soleKnowledgeCount)),
      input.userId,
    ],
  );
}

export async function deleteWorkloadEntry(
  client: PoolClient,
  input: { orgId: string; entryId: string },
): Promise<void> {
  await client.query(`DELETE FROM bus_factor_workload_entries WHERE id = $1 AND org_id = $2`, [
    input.entryId,
    input.orgId,
  ]);
}
