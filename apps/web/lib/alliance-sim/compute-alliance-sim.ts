import type { PoolClient } from "@neondatabase/serverless";
import { ALLIANCE_SIM_ROLES, computeAllianceSimResult, isAllianceSimRole } from ".";
import type { AllianceSimResult, AllianceSimRobot, AllianceSimRole, AllianceSimScenario } from "./types";

export type AllianceSimSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type AllianceSimView =
  | {
      status: "setup_required";
      message: string;
      steps: AllianceSimSetupStep[];
      orgId: null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      scenarios: AllianceSimScenario[];
      selectedScenarioId: string | null;
      robots: AllianceSimRobot[];
      result: AllianceSimResult;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type ScenarioRow = {
  id: string;
  name: string;
  eventName: string | null;
  seasonYear: number;
  notes: string | null;
  createdAt: string;
};

function mapScenario(row: ScenarioRow): AllianceSimScenario {
  return {
    id: row.id,
    name: row.name,
    eventName: row.eventName,
    seasonYear: row.seasonYear,
    notes: row.notes,
    createdAt: row.createdAt,
  };
}

type RobotRow = {
  id: string;
  teamNumber: number;
  teamName: string | null;
  capableRoles: string[] | null;
  roleStrengths: Record<string, number> | null;
};

function mapRobot(row: RobotRow): AllianceSimRobot {
  const capableRoles = Array.isArray(row.capableRoles)
    ? row.capableRoles.filter((role): role is AllianceSimRole => isAllianceSimRole(role))
    : [];
  const roleStrengths: Partial<Record<AllianceSimRole, number>> = {};
  if (row.roleStrengths && typeof row.roleStrengths === "object") {
    for (const [key, value] of Object.entries(row.roleStrengths)) {
      if (isAllianceSimRole(key) && typeof value === "number" && Number.isFinite(value)) {
        roleStrengths[key] = value;
      }
    }
  }
  return {
    id: row.id,
    teamNumber: Number(row.teamNumber) || 0,
    teamName: row.teamName,
    capableRoles,
    roleStrengths,
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

export async function computeAllianceSimView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; requestedScenario?: string | null },
): Promise<AllianceSimView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to simulate playoff-alliance role assignments.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const scenarioResult = await client.query<ScenarioRow>(
    `SELECT id, name, event_name AS "eventName", season_year AS "seasonYear",
            notes, created_at::text AS "createdAt"
     FROM alliance_sim_scenarios
     WHERE org_id = $1
     ORDER BY created_at DESC`,
    [org.orgId],
  );
  const scenarios = scenarioResult.rows.map(mapScenario);

  const selectedScenarioId =
    input.requestedScenario && scenarios.some((s) => s.id === input.requestedScenario)
      ? input.requestedScenario
      : (scenarios[0]?.id ?? null);

  let robots: AllianceSimRobot[] = [];
  if (selectedScenarioId) {
    const robotResult = await client.query<RobotRow>(
      `SELECT id, team_number AS "teamNumber", team_name AS "teamName",
              capable_roles AS "capableRoles", role_strengths AS "roleStrengths"
       FROM alliance_sim_robots
       WHERE org_id = $1 AND scenario_id = $2
       ORDER BY created_at ASC`,
      [org.orgId, selectedScenarioId],
    );
    robots = robotResult.rows.map(mapRobot);
  }

  const result = computeAllianceSimResult(robots);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    scenarios,
    selectedScenarioId,
    robots,
    result,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createScenario(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    eventName: string | null;
    seasonYear: number;
    notes: string | null;
  },
): Promise<string> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO alliance_sim_scenarios (org_id, name, event_name, season_year, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
    [input.orgId, input.name, input.eventName, input.seasonYear, input.notes, input.userId],
  );
  const id = inserted.rows[0]?.id;
  if (!id) throw new Error("Failed to create scenario");
  return id;
}

export async function deleteScenario(
  client: PoolClient,
  input: { orgId: string; scenarioId: string },
): Promise<void> {
  await client.query(`DELETE FROM alliance_sim_scenarios WHERE id = $1 AND org_id = $2`, [
    input.scenarioId,
    input.orgId,
  ]);
}

export async function addRobot(
  client: PoolClient,
  input: {
    orgId: string;
    scenarioId: string;
    teamNumber: number;
    teamName: string | null;
    capableRoles: AllianceSimRole[];
    roleStrengths: Partial<Record<AllianceSimRole, number>>;
  },
): Promise<void> {
  const roles = input.capableRoles.filter((role) => (ALLIANCE_SIM_ROLES as string[]).includes(role));
  await client.query(
    `INSERT INTO alliance_sim_robots (org_id, scenario_id, team_number, team_name, capable_roles, role_strengths)
     VALUES ($1,$2,$3,$4,$5::text[],$6::jsonb)`,
    [
      input.orgId,
      input.scenarioId,
      input.teamNumber,
      input.teamName,
      roles,
      JSON.stringify(input.roleStrengths ?? {}),
    ],
  );
}

export async function deleteRobot(
  client: PoolClient,
  input: { orgId: string; robotId: string },
): Promise<void> {
  await client.query(`DELETE FROM alliance_sim_robots WHERE id = $1 AND org_id = $2`, [
    input.robotId,
    input.orgId,
  ]);
}
