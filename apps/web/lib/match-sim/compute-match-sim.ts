import type { PoolClient } from "@neondatabase/serverless";
import { computeAllianceCapability, computeMatchSimResult } from ".";
import type {
  AllianceColor,
  MatchSimResult,
  MatchSimRun,
  MatchSimView,
  TeamCapability,
} from "./types";

function currentYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
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

function setupView(message: string, orgId: string | null): MatchSimView {
  return {
    status: "setup_required",
    message,
    steps: [
      { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      { id: "reference", label: "Sync reference data", detail: "Confirm TBA/Statbotics EPA sync has run for your event", href: "/rankings" },
    ],
    orgId,
  };
}

/**
 * Resolves real EPA capability rows for a set of team keys — event-level EPA (preferred) falling
 * back to season year EPA — from the shared reference cache. Teams with nothing synced come back
 * with `hasData: false` and null phase numbers rather than a fabricated guess.
 */
export async function resolveTeamCapabilities(
  client: PoolClient,
  teamKeys: string[],
  eventKey: string | null,
  year: number,
): Promise<TeamCapability[]> {
  if (teamKeys.length === 0) return [];

  const [teamRows, eventRows, yearRows] = await Promise.all([
    client.query<{ teamKey: string; teamNumber: number }>(
      `SELECT team_key AS "teamKey", team_number AS "teamNumber" FROM teams_ref WHERE team_key = ANY($1::text[])`,
      [teamKeys],
    ),
    eventKey
      ? client.query<{
          teamKey: string;
          epaAuto: number | null;
          epaTeleop: number | null;
          epaEndgame: number | null;
          epaTotal: number | null;
          source: string;
        }>(
          `SELECT DISTINCT ON (team_key)
              team_key AS "teamKey", epa_auto AS "epaAuto", epa_teleop AS "epaTeleop",
              epa_endgame AS "epaEndgame", epa_total AS "epaTotal", source
           FROM team_event_metrics
           WHERE event_key = $1 AND team_key = ANY($2::text[])
           ORDER BY team_key, CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END, synced_at DESC NULLS LAST`,
          [eventKey, teamKeys],
        )
      : Promise.resolve({ rows: [] as Array<{
          teamKey: string;
          epaAuto: number | null;
          epaTeleop: number | null;
          epaEndgame: number | null;
          epaTotal: number | null;
          source: string;
        }> }),
    client.query<{
      teamKey: string;
      epaAuto: number | null;
      epaTeleop: number | null;
      epaEndgame: number | null;
      epaTotal: number | null;
      source: string;
    }>(
      `SELECT DISTINCT ON (team_key)
          team_key AS "teamKey", epa_auto AS "epaAuto", epa_teleop AS "epaTeleop",
          epa_endgame AS "epaEndgame", epa_total AS "epaTotal", source
       FROM team_year_metrics
       WHERE team_key = ANY($1::text[]) AND year BETWEEN $2 AND $3
       ORDER BY team_key, year DESC, CASE source WHEN 'statbotics' THEN 0 WHEN 'tba' THEN 1 ELSE 2 END, synced_at DESC NULLS LAST`,
      [teamKeys, year - 2, year],
    ),
  ]);

  const numberByKey = new Map(teamRows.rows.map((r) => [r.teamKey, r.teamNumber]));
  const eventByKey = new Map(eventRows.rows.map((r) => [r.teamKey, r]));
  const yearByKey = new Map(yearRows.rows.map((r) => [r.teamKey, r]));

  return teamKeys.map((teamKey) => {
    const preferred = eventByKey.get(teamKey) ?? yearByKey.get(teamKey) ?? null;
    const hasData = preferred != null && (preferred.epaAuto != null || preferred.epaTeleop != null || preferred.epaEndgame != null);
    return {
      teamKey,
      teamNumber: numberByKey.get(teamKey) ?? null,
      epaAuto: preferred?.epaAuto ?? null,
      epaTeleop: preferred?.epaTeleop ?? null,
      epaEndgame: preferred?.epaEndgame ?? null,
      epaTotal: preferred?.epaTotal ?? null,
      source: preferred?.source ?? null,
      hasData,
    } satisfies TeamCapability;
  });
}

export async function simulateMatch(
  client: PoolClient,
  input: { redTeamKeys: string[]; blueTeamKeys: string[]; eventKey: string | null; year?: number | null },
): Promise<MatchSimResult> {
  const year = input.year && input.year > 2000 ? input.year : currentYear();
  const [redTeams, blueTeams] = await Promise.all([
    resolveTeamCapabilities(client, input.redTeamKeys, input.eventKey, year),
    resolveTeamCapabilities(client, input.blueTeamKeys, input.eventKey, year),
  ]);
  const red = computeAllianceCapability("red", redTeams);
  const blue = computeAllianceCapability("blue", blueTeams);
  return computeMatchSimResult(red, blue);
}

type RunRow = {
  id: string;
  label: string;
  eventKey: string | null;
  matchKey: string | null;
  redTeamKeys: string[];
  blueTeamKeys: string[];
  result: MatchSimResult;
  createdAt: string;
};

function mapRun(row: RunRow): MatchSimRun {
  return {
    id: row.id,
    label: row.label,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    redTeamKeys: row.redTeamKeys,
    blueTeamKeys: row.blueTeamKeys,
    result: row.result,
    createdAt: row.createdAt,
  };
}

export async function computeMatchSimView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; activeRunId?: string | null },
): Promise<MatchSimView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  if (!org) {
    return setupView("Select a team to run the match simulator.", null);
  }

  const runsResult = await client.query<RunRow>(
    `SELECT id, label, event_key AS "eventKey", match_key AS "matchKey",
            red_team_keys AS "redTeamKeys", blue_team_keys AS "blueTeamKeys",
            result, created_at::text AS "createdAt"
     FROM match_sim_runs
     WHERE org_id = $1
     ORDER BY created_at DESC
     LIMIT 25`,
    [org.orgId],
  );

  const runs = runsResult.rows.map(mapRun);
  const active = input.activeRunId
    ? (runs.find((r) => r.id === input.activeRunId) ?? runs[0] ?? null)
    : (runs[0] ?? null);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    runs,
    active,
    computedAt: new Date().toISOString(),
  };
}

export async function saveRun(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    label: string;
    eventKey: string | null;
    matchKey: string | null;
    redTeamKeys: string[];
    blueTeamKeys: string[];
    result: MatchSimResult;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO match_sim_runs (
       org_id, label, event_key, match_key, red_team_keys, blue_team_keys, result, created_by
     ) VALUES ($1,$2,$3,$4,$5::text[],$6::text[],$7::jsonb,$8)`,
    [
      input.orgId,
      input.label,
      input.eventKey,
      input.matchKey,
      input.redTeamKeys,
      input.blueTeamKeys,
      JSON.stringify(input.result),
      input.userId,
    ],
  );
}

export async function deleteRun(client: PoolClient, input: { orgId: string; runId: string }): Promise<void> {
  await client.query(`DELETE FROM match_sim_runs WHERE id = $1 AND org_id = $2`, [input.runId, input.orgId]);
}

export type { AllianceColor, MatchSimView };
