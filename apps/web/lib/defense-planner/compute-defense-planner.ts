import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { DRIVETRAIN_TYPES, recommendDefensePlan } from ".";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { DrivetrainType, Matchup, RobotProfile } from "./types";

export { DRIVETRAIN_TYPES };

export type DefensePlannerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO defense metrics. */
function setupSteps(orgId: string | null): DefensePlannerSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open Defense Planner.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Event strategy stays empty until real metrics exist.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout rows stay blank until your team enters them.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

export type DefensePlannerView =
  | {
      status: "setup_required";
      message: string;
      steps: DefensePlannerSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      robotProfile: RobotProfile | null;
      matchups: Matchup[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isDrivetrain(value: unknown): value is DrivetrainType {
  return typeof value === "string" && (DRIVETRAIN_TYPES as string[]).includes(value);
}

type ProfileRow = {
  seasonYear: number;
  massLbs: string;
  drivetrainType: string;
  topSpeedFps: string | null;
  notes: string;
  updatedAt: string;
};

function mapProfile(row: ProfileRow): RobotProfile {
  return {
    seasonYear: row.seasonYear,
    massLbs: Number(row.massLbs) || 0,
    drivetrain: isDrivetrain(row.drivetrainType) ? row.drivetrainType : "other",
    topSpeedFps: row.topSpeedFps != null ? Number(row.topSpeedFps) : null,
    notes: row.notes,
    updatedAt: row.updatedAt,
  };
}

type MatchupRow = {
  id: string;
  seasonYear: number;
  opponentTeamNumber: number;
  opponentTeamName: string;
  eventKey: string | null;
  opponentMassLbs: string;
  opponentDrivetrainType: string;
  opponentCycleTimeSec: string;
  opponentCyclePath: string;
  opponentAvgPointsPerCycle: string;
  notes: string;
  recommendation: string;
  assignedDefender: string;
  confidence: string;
  rationale: string;
  computedAt: string;
  createdAt: string;
};

function mapMatchup(row: MatchupRow): Matchup {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    opponentTeamNumber: row.opponentTeamNumber,
    opponentTeamName: row.opponentTeamName,
    eventKey: row.eventKey,
    opponentMassLbs: Number(row.opponentMassLbs) || 0,
    opponentDrivetrain: isDrivetrain(row.opponentDrivetrainType) ? row.opponentDrivetrainType : "other",
    opponentCycleTimeSec: Number(row.opponentCycleTimeSec) || 0,
    opponentCyclePath: row.opponentCyclePath,
    opponentAvgPointsPerCycle: Number(row.opponentAvgPointsPerCycle) || 0,
    notes: row.notes,
    recommendation:
      row.recommendation === "play_defense" || row.recommendation === "stay_offense"
        ? row.recommendation
        : "situational",
    assignedDefender:
      row.assignedDefender === "us" || row.assignedDefender === "none" ? row.assignedDefender : "situational",
    confidence: Number(row.confidence) || 0,
    rationale: row.rationale,
    computedAt: row.computedAt,
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

export async function computeDefensePlannerView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<DefensePlannerView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to plan defensive matchups.",
      steps: setupSteps(null),
      orgId: null,
      seasonYear,
    };
  }

  const [profileResult, matchupResult, seasonResult] = await Promise.all([
    client.query<ProfileRow>(
      `SELECT season_year AS "seasonYear", mass_lbs AS "massLbs", drivetrain_type AS "drivetrainType",
              top_speed_fps AS "topSpeedFps", notes, updated_at AS "updatedAt"
       FROM defense_planner_robot_profiles
       WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<MatchupRow>(
      `SELECT id, season_year AS "seasonYear", opponent_team_number AS "opponentTeamNumber",
              opponent_team_name AS "opponentTeamName", event_key AS "eventKey",
              opponent_mass_lbs AS "opponentMassLbs", opponent_drivetrain_type AS "opponentDrivetrainType",
              opponent_cycle_time_sec AS "opponentCycleTimeSec", opponent_cycle_path AS "opponentCyclePath",
              opponent_avg_points_per_cycle AS "opponentAvgPointsPerCycle", notes,
              recommendation, assigned_defender AS "assignedDefender", confidence, rationale,
              computed_at AS "computedAt", created_at AS "createdAt"
       FROM defense_planner_matchups
       WHERE org_id = $1 AND season_year = $2
       ORDER BY computed_at DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM defense_planner_matchups WHERE org_id = $1
       UNION
       SELECT DISTINCT season_year AS "seasonYear" FROM defense_planner_robot_profiles WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    robotProfile: profileResult.rows[0] ? mapProfile(profileResult.rows[0]) : null,
    matchups: matchupResult.rows.map(mapMatchup),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function upsertRobotProfile(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    massLbs: number;
    drivetrain: DrivetrainType;
    topSpeedFps: number | null;
    notes: string;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO defense_planner_robot_profiles (org_id, season_year, mass_lbs, drivetrain_type, top_speed_fps, notes, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, season_year) DO UPDATE SET
       mass_lbs = EXCLUDED.mass_lbs,
       drivetrain_type = EXCLUDED.drivetrain_type,
       top_speed_fps = EXCLUDED.top_speed_fps,
       notes = EXCLUDED.notes,
       updated_by = EXCLUDED.updated_by,
       updated_at = now()`,
    [input.orgId, input.seasonYear, input.massLbs, input.drivetrain, input.topSpeedFps, input.notes, input.userId],
  );
}

/**
 * Computes the defense recommendation locally (deterministic, grounded only in the
 * supplied mass/drivetrain/cycle numbers) then meters the write through the standard
 * AI-usage path — matching the local/deterministic metering pattern used for other
 * zero-provider-cost computed briefs. No external model call, no fabricated data.
 */
export async function logMatchup(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    opponentTeamNumber: number;
    opponentTeamName: string;
    eventKey: string | null;
    opponentMassLbs: number;
    opponentDrivetrain: DrivetrainType;
    opponentCycleTimeSec: number;
    opponentCyclePath: string;
    opponentAvgPointsPerCycle: number;
    notes: string;
    robotProfile: RobotProfile | null;
  },
): Promise<void> {
  const ourMassLbs = input.robotProfile?.massLbs ?? 0;
  const ourDrivetrain = input.robotProfile?.drivetrain ?? "west_coast";

  const plan = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "defense_planner",
    requestId: `defense-planner-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      opponentTeamNumber: input.opponentTeamNumber,
      seasonYear: input.seasonYear,
      note: "Deterministic mass/drivetrain vs cycle-path computation — no external model call",
    },
    invoke: async () => ({
      value: recommendDefensePlan({
        ourMassLbs,
        ourDrivetrain,
        theirMassLbs: input.opponentMassLbs,
        theirDrivetrain: input.opponentDrivetrain,
        theirCycleTimeSec: input.opponentCycleTimeSec,
        theirAvgPointsPerCycle: input.opponentAvgPointsPerCycle,
        opponentTeamNumber: input.opponentTeamNumber,
        opponentCyclePath: input.opponentCyclePath,
      }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-defense-planner-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO defense_planner_matchups (
       org_id, season_year, opponent_team_number, opponent_team_name, event_key,
       opponent_mass_lbs, opponent_drivetrain_type, opponent_cycle_time_sec, opponent_cycle_path,
       opponent_avg_points_per_cycle, notes, recommendation, assigned_defender, confidence, rationale,
       created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      input.orgId,
      input.seasonYear,
      input.opponentTeamNumber,
      input.opponentTeamName,
      input.eventKey,
      input.opponentMassLbs,
      input.opponentDrivetrain,
      input.opponentCycleTimeSec,
      input.opponentCyclePath,
      input.opponentAvgPointsPerCycle,
      input.notes,
      plan.recommendation,
      plan.assignedDefender,
      plan.confidence,
      plan.rationale,
      input.userId,
    ],
  );
}

export async function deleteMatchup(
  client: PoolClient,
  input: { orgId: string; matchupId: string },
): Promise<void> {
  await client.query(`DELETE FROM defense_planner_matchups WHERE id = $1 AND org_id = $2`, [
    input.matchupId,
    input.orgId,
  ]);
}
