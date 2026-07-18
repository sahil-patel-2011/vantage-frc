import type { PoolClient } from "@neondatabase/serverless";
import { DEFAULT_STATIONS, generateRotation, summarizePlan } from ".";
import type { ShiftBalancerPlan, ShiftBalancerScout, ShiftBalancerSummary } from "./types";

export type ShiftBalancerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ShiftBalancerView =
  | {
      status: "setup_required";
      message: string;
      steps: ShiftBalancerSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      scouts: ShiftBalancerScout[];
      plans: ShiftBalancerPlan[];
      latestSummary: ShiftBalancerSummary | null;
      computedAt: string;
    };

type ScoutRow = {
  id: string;
  name: string;
  active: boolean;
};

type PlanRow = {
  id: string;
  label: string;
  matchCount: number;
  stations: string[];
  maxConsecutiveMatches: number;
  assignments: unknown;
  createdAt: string;
};

function mapScout(row: ScoutRow): ShiftBalancerScout {
  return { id: row.id, name: row.name, active: row.active };
}

function mapPlan(row: PlanRow): ShiftBalancerPlan {
  const assignments = Array.isArray(row.assignments)
    ? (row.assignments as ShiftBalancerPlan["assignments"])
    : [];
  return {
    id: row.id,
    label: row.label,
    matchCount: Number(row.matchCount) || 0,
    stations: Array.isArray(row.stations) ? row.stations : DEFAULT_STATIONS,
    maxConsecutiveMatches: Number(row.maxConsecutiveMatches) || 1,
    assignments,
    createdAt: row.createdAt,
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

export async function computeShiftBalancerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ShiftBalancerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to build scout shift rotations.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [scoutResult, planResult] = await Promise.all([
    client.query<ScoutRow>(
      `SELECT id, name, active
       FROM shift_balancer_scouts
       WHERE org_id = $1
       ORDER BY name`,
      [org.orgId],
    ),
    client.query<PlanRow>(
      `SELECT id, label, match_count AS "matchCount", stations,
              max_consecutive_matches AS "maxConsecutiveMatches",
              assignments, created_at::text AS "createdAt"
       FROM shift_balancer_plans
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [org.orgId],
    ),
  ]);

  const scouts = scoutResult.rows.map(mapScout);
  const plans = planResult.rows.map(mapPlan);
  const latestPlan = plans[0] ?? null;
  const latestSummary = latestPlan
    ? summarizePlan({
        scouts,
        matchCount: latestPlan.matchCount,
        stations: latestPlan.stations,
        assignments: latestPlan.assignments,
      })
    : null;

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    scouts,
    plans,
    latestSummary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addScout(
  client: PoolClient,
  input: { orgId: string; userId: string; name: string },
): Promise<void> {
  await client.query(
    `INSERT INTO shift_balancer_scouts (org_id, name, created_by) VALUES ($1,$2,$3)`,
    [input.orgId, input.name, input.userId],
  );
}

export async function setScoutActive(
  client: PoolClient,
  input: { orgId: string; scoutId: string; active: boolean },
): Promise<void> {
  await client.query(`UPDATE shift_balancer_scouts SET active = $1 WHERE id = $2 AND org_id = $3`, [
    input.active,
    input.scoutId,
    input.orgId,
  ]);
}

export async function removeScout(
  client: PoolClient,
  input: { orgId: string; scoutId: string },
): Promise<void> {
  await client.query(`DELETE FROM shift_balancer_scouts WHERE id = $1 AND org_id = $2`, [
    input.scoutId,
    input.orgId,
  ]);
}

export async function generatePlan(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    label: string;
    matchCount: number;
    stations: string[];
    maxConsecutiveMatches: number;
  },
): Promise<void> {
  const scoutResult = await client.query<ScoutRow>(
    `SELECT id, name, active FROM shift_balancer_scouts WHERE org_id = $1 AND active = true ORDER BY name`,
    [input.orgId],
  );
  const scouts = scoutResult.rows.map(mapScout);
  const stations = input.stations.length > 0 ? input.stations : DEFAULT_STATIONS;
  const assignments = generateRotation({
    scouts,
    matchCount: input.matchCount,
    stations,
    maxConsecutiveMatches: input.maxConsecutiveMatches,
  });

  await client.query(
    `INSERT INTO shift_balancer_plans
       (org_id, label, match_count, stations, max_consecutive_matches, assignments, generated_by)
     VALUES ($1,$2,$3,$4::text[],$5,$6::jsonb,$7)`,
    [
      input.orgId,
      input.label,
      input.matchCount,
      stations,
      input.maxConsecutiveMatches,
      JSON.stringify(assignments),
      input.userId,
    ],
  );
}

export async function deletePlan(
  client: PoolClient,
  input: { orgId: string; planId: string },
): Promise<void> {
  await client.query(`DELETE FROM shift_balancer_plans WHERE id = $1 AND org_id = $2`, [
    input.planId,
    input.orgId,
  ]);
}
