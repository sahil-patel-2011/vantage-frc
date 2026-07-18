import type { PoolClient } from "@neondatabase/serverless";
import { runMonteCarloTrajectory } from ".";
import type { RemainingEvent, TrajectoryRunSummary, TrajectoryScenario } from "./types";

export const DEFAULT_SIM_RUNS = 2000;
const MIN_FIELD_SAMPLES = 5;

export type TrajectorySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type TrajectoryView =
  | {
      status: "setup_required";
      message: string;
      steps: TrajectorySetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      teamKey: string;
      districtKey: string;
      seasonYear: number;
      remainingEvents: RemainingEvent[];
      latestRun: TrajectoryRunSummary | null;
      scenarios: TrajectoryScenario[];
      computedAt: string;
    };

function setupSteps(orgId: string | null): TrajectorySetupStep[] {
  const suffix = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  return [
    { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
    {
      id: "active-event",
      label: "Connect an event",
      detail: "Set your active district event so the trajectory simulator knows which district to project.",
      href: `/command${suffix}`,
    },
  ];
}

function setupRequiredView(message: string, orgId: string | null = null): TrajectoryView {
  return { status: "setup_required", message, steps: setupSteps(orgId), orgId };
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

type FieldStats = { mean: number; stdDev: number; sampleSize: number };

function computeFieldStats(epaValues: number[]): FieldStats {
  const n = epaValues.length;
  if (n === 0) return { mean: 0, stdDev: 0, sampleSize: 0 };
  const mean = epaValues.reduce((sum, v) => sum + v, 0) / n;
  const variance = epaValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  return { mean, stdDev: Math.sqrt(variance), sampleSize: n };
}

export async function computeTrajectoryView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; targetPoints?: number | null; simRuns?: number | null },
): Promise<TrajectoryView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) return setupRequiredView("Select a team workspace to project district trajectory.");
  if (!org.teamNumber) {
    return setupRequiredView(
      "Set your team number in workspace settings so the trajectory simulator can find its EPA baseline.",
      org.orgId,
    );
  }

  const activeContext = await client.query<{ activeEventKey: string | null }>(
    `SELECT active_event_key AS "activeEventKey" FROM org_active_context WHERE org_id = $1`,
    [org.orgId],
  );
  const activeEventKey = activeContext.rows[0]?.activeEventKey ?? null;
  if (!activeEventKey) {
    return setupRequiredView(
      "Connect an active event to project your district trajectory — none is set yet.",
      org.orgId,
    );
  }

  const eventResult = await client.query<{ districtKey: string | null; year: number | null }>(
    `SELECT district_key AS "districtKey", year FROM events_ref WHERE event_key = $1`,
    [activeEventKey],
  );
  const districtKey = eventResult.rows[0]?.districtKey ?? null;
  const seasonYear = eventResult.rows[0]?.year ?? new Date().getUTCFullYear();
  if (!districtKey) {
    return setupRequiredView(
      "Your active event isn't a district event — the trajectory simulator only projects district points.",
      org.orgId,
    );
  }

  const teamResult = await client.query<{ teamKey: string }>(
    `SELECT team_key AS "teamKey" FROM teams_ref WHERE team_number = $1`,
    [org.teamNumber],
  );
  const teamKey = teamResult.rows[0]?.teamKey ?? null;
  if (!teamKey) {
    return setupRequiredView(
      "No reference-cache record for your team yet — TBA/Statbotics sync hasn't picked it up.",
      org.orgId,
    );
  }

  const [baselineResult, fieldResult, eventsResult, projectionResult, scenariosResult] = await Promise.all([
    client.query<{ epaTotal: number | null }>(
      `SELECT epa_total AS "epaTotal" FROM team_year_metrics
       WHERE team_key = $1 AND year = $2 AND source = 'statbotics' AND epa_total IS NOT NULL
       ORDER BY synced_at DESC LIMIT 1`,
      [teamKey, seasonYear],
    ),
    client.query<{ epaTotal: number }>(
      `SELECT tem.epa_total AS "epaTotal"
       FROM team_event_metrics tem
       JOIN events_ref er ON er.event_key = tem.event_key
       WHERE er.district_key = $1 AND er.year = $2 AND tem.source = 'statbotics' AND tem.epa_total IS NOT NULL`,
      [districtKey, seasonYear],
    ),
    client.query<{ eventKey: string; name: string; startDate: string | null; attended: boolean }>(
      `SELECT er.event_key AS "eventKey", COALESCE(er.short_name, er.name) AS "name",
              er.start_date::text AS "startDate",
              EXISTS(SELECT 1 FROM team_event_metrics tem WHERE tem.team_key = $2 AND tem.event_key = er.event_key) AS "attended"
       FROM events_ref er
       WHERE er.district_key = $1 AND er.year = $3
       ORDER BY er.start_date ASC NULLS LAST`,
      [districtKey, teamKey, seasonYear],
    ),
    client.query<{
      simRuns: number;
      qualifyProbability: number;
      pointsNeeded: number | null;
      updatedAt: string;
      runId: string | null;
    }>(
      `SELECT sim_runs AS "simRuns", qualify_probability AS "qualifyProbability",
              points_needed AS "pointsNeeded", updated_at::text AS "updatedAt", run_id AS "runId"
       FROM district_trajectory_sim_projections
       WHERE org_id = $1 AND team_key = $2 AND season_year = $3`,
      [org.orgId, teamKey, seasonYear],
    ),
    client.query<{ id: string; label: string; epaDeltaPct: number; skipNextEvent: boolean; createdAt: string }>(
      `SELECT id, label, epa_delta_pct AS "epaDeltaPct", skip_next_event AS "skipNextEvent", created_at::text AS "createdAt"
       FROM district_trajectory_sim_scenarios
       WHERE org_id = $1 AND team_key = $2 AND season_year = $3
       ORDER BY created_at DESC`,
      [org.orgId, teamKey, seasonYear],
    ),
  ]);

  const baselineEpa = baselineResult.rows[0]?.epaTotal ?? null;
  const fieldValues = fieldResult.rows.map((r) => Number(r.epaTotal)).filter((v) => Number.isFinite(v));
  const fieldStats = computeFieldStats(fieldValues);

  if (baselineEpa == null || fieldStats.sampleSize < MIN_FIELD_SAMPLES) {
    return setupRequiredView(
      "Not enough cached EPA data yet for your team and district — sync TBA/Statbotics reference data first.",
      org.orgId,
    );
  }

  const remainingEvents: RemainingEvent[] = eventsResult.rows
    .filter((row) => !row.attended)
    .map((row) => ({ eventKey: row.eventKey, name: row.name, startDate: row.startDate }));

  const scenarios: TrajectoryScenario[] = scenariosResult.rows.map((row) => ({
    id: row.id,
    label: row.label,
    epaDeltaPct: Number(row.epaDeltaPct) || 0,
    skipNextEvent: row.skipNextEvent,
    createdAt: row.createdAt,
  }));

  const simRuns = input.simRuns && input.simRuns > 0 ? Math.min(20000, Math.round(input.simRuns)) : DEFAULT_SIM_RUNS;

  const simulation = runMonteCarloTrajectory(
    {
      baselineEpa,
      fieldEpaMean: fieldStats.mean,
      fieldEpaStdDev: fieldStats.stdDev,
      fieldSize: fieldStats.sampleSize,
      eventsRemaining: remainingEvents.length,
      simRuns,
    },
    input.targetPoints ?? null,
  );

  const savedProjection = projectionResult.rows[0] ?? null;
  const latestRun: TrajectoryRunSummary = {
    id: savedProjection?.runId ?? "live",
    simRuns,
    baselineEpa,
    eventsRemaining: remainingEvents.length,
    qualifyProbability: simulation.qualifyProbability,
    pointsNeeded: simulation.pointsNeeded,
    projectedPointsP10: simulation.projectedPointsP10,
    projectedPointsP50: simulation.projectedPointsP50,
    projectedPointsP90: simulation.projectedPointsP90,
    probabilityCurve: simulation.probabilityCurve,
    createdAt: new Date().toISOString(),
  };

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    teamKey,
    districtKey,
    seasonYear,
    remainingEvents,
    latestRun,
    scenarios,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function saveTrajectoryRun(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    teamKey: string;
    teamNumber: number | null;
    districtKey: string;
    seasonYear: number;
    simRuns: number;
    baselineEpa: number | null;
    eventsRemaining: number;
    qualifyProbability: number;
    pointsNeeded: number | null;
    projectedPointsP10: number;
    projectedPointsP50: number;
    projectedPointsP90: number;
    probabilityCurve: unknown;
    scenario: unknown;
  },
): Promise<string> {
  const runResult = await client.query<{ id: string }>(
    `INSERT INTO district_trajectory_sim_runs (
       org_id, team_key, team_number, district_key, season_year, sim_runs, baseline_epa,
       events_remaining, qualify_probability, points_needed, projected_points_p10,
       projected_points_p50, projected_points_p90, probability_curve, scenario, computed_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16)
     RETURNING id`,
    [
      input.orgId,
      input.teamKey,
      input.teamNumber,
      input.districtKey,
      input.seasonYear,
      input.simRuns,
      input.baselineEpa,
      input.eventsRemaining,
      input.qualifyProbability,
      input.pointsNeeded,
      input.projectedPointsP10,
      input.projectedPointsP50,
      input.projectedPointsP90,
      JSON.stringify(input.probabilityCurve ?? []),
      JSON.stringify(input.scenario ?? {}),
      input.userId,
    ],
  );
  const runId = runResult.rows[0]?.id;

  await client.query(
    `INSERT INTO district_trajectory_sim_projections (
       org_id, team_key, team_number, season_year, sim_runs, qualify_probability, points_needed, run_id, updated_by, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now())
     ON CONFLICT (org_id, team_key, season_year) DO UPDATE SET
       sim_runs = EXCLUDED.sim_runs,
       qualify_probability = EXCLUDED.qualify_probability,
       points_needed = EXCLUDED.points_needed,
       run_id = EXCLUDED.run_id,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [
      input.orgId,
      input.teamKey,
      input.teamNumber,
      input.seasonYear,
      input.simRuns,
      input.qualifyProbability,
      input.pointsNeeded,
      runId,
      input.userId,
    ],
  );
  return runId ?? "";
}

export async function saveScenario(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    teamKey: string;
    seasonYear: number;
    label: string;
    epaDeltaPct: number;
    skipNextEvent: boolean;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO district_trajectory_sim_scenarios (
       org_id, team_key, season_year, label, epa_delta_pct, skip_next_event, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.orgId, input.teamKey, input.seasonYear, input.label, input.epaDeltaPct, input.skipNextEvent, input.userId],
  );
}

export async function deleteScenario(
  client: PoolClient,
  input: { orgId: string; scenarioId: string },
): Promise<void> {
  await client.query(`DELETE FROM district_trajectory_sim_scenarios WHERE id = $1 AND org_id = $2`, [
    input.scenarioId,
    input.orgId,
  ]);
}
