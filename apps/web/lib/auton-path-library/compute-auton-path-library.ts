import type { PoolClient } from "@neondatabase/serverless";
import { attachStats, currentSeasonYear, summarizeLibrary } from ".";
import type {
  AutonPathLibrarySummary,
  AutonPathRun,
  AutonPathRunOutcome,
  AutonPathStartPosition,
  AutonPathWithStats,
} from "./types";

export type AutonPathLibrarySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type AutonPathLibraryView =
  | {
      status: "setup_required";
      message: string;
      steps: AutonPathLibrarySetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      paths: AutonPathWithStats[];
      summary: AutonPathLibrarySummary;
      computedAt: string;
    };

type PathRow = {
  id: string;
  name: string;
  startPosition: AutonPathStartPosition;
  description: string | null;
  gamePieces: number;
  seasonYear: number;
  active: boolean;
  createdAt: string;
};

type RunRow = {
  id: string;
  pathId: string;
  outcome: AutonPathRunOutcome;
  occurredOn: string;
  eventLabel: string | null;
  matchLabel: string | null;
  notes: string | null;
  loggedBy: string;
  createdAt: string;
};

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

export async function computeAutonPathLibraryView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<AutonPathLibraryView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to build your autonomous path library.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [pathResult, runResult, seasonResult] = await Promise.all([
    client.query<PathRow>(
      `SELECT id, name, start_position AS "startPosition", description,
              game_pieces AS "gamePieces", season_year AS "seasonYear", active,
              created_at AS "createdAt"
       FROM auton_path_library_paths
       WHERE org_id = $1 AND season_year = $2
       ORDER BY active DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<RunRow>(
      `SELECT r.id, r.path_id AS "pathId", r.outcome, r.occurred_on::text AS "occurredOn",
              r.event_label AS "eventLabel", r.match_label AS "matchLabel", r.notes,
              r.logged_by AS "loggedBy", r.created_at AS "createdAt"
       FROM auton_path_library_runs r
       JOIN auton_path_library_paths p ON p.id = r.path_id
       WHERE r.org_id = $1 AND p.season_year = $2
       ORDER BY r.occurred_on DESC, r.created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM auton_path_library_paths WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const paths = pathResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    startPosition: row.startPosition,
    description: row.description,
    gamePieces: Number(row.gamePieces) || 0,
    seasonYear: row.seasonYear,
    active: row.active,
    createdAt: row.createdAt,
  }));
  const runs: AutonPathRun[] = runResult.rows.map((row) => ({
    id: row.id,
    pathId: row.pathId,
    outcome: row.outcome,
    occurredOn: row.occurredOn,
    eventLabel: row.eventLabel,
    matchLabel: row.matchLabel,
    notes: row.notes,
    loggedBy: row.loggedBy,
    createdAt: row.createdAt,
  }));

  const pathsWithStats = attachStats(paths, runs);
  const summary = summarizeLibrary(pathsWithStats);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    paths: pathsWithStats,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function createPath(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    startPosition: AutonPathStartPosition;
    description: string | null;
    gamePieces: number;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO auton_path_library_paths (
       org_id, name, start_position, description, game_pieces, season_year, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.orgId,
      input.name,
      input.startPosition,
      input.description,
      Math.max(0, Math.round(input.gamePieces)),
      input.seasonYear,
      input.userId,
    ],
  );
}

export async function setPathActive(
  client: PoolClient,
  input: { orgId: string; pathId: string; active: boolean },
): Promise<void> {
  await client.query(
    `UPDATE auton_path_library_paths SET active = $1 WHERE id = $2 AND org_id = $3`,
    [input.active, input.pathId, input.orgId],
  );
}

export async function deletePath(
  client: PoolClient,
  input: { orgId: string; pathId: string },
): Promise<void> {
  await client.query(`DELETE FROM auton_path_library_paths WHERE id = $1 AND org_id = $2`, [
    input.pathId,
    input.orgId,
  ]);
}

export async function logRun(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    pathId: string;
    outcome: AutonPathRunOutcome;
    occurredOn: string;
    eventLabel: string | null;
    matchLabel: string | null;
    notes: string | null;
  },
): Promise<void> {
  // Confirm the path belongs to this org before attaching a run to it (defense in depth on top of RLS).
  const owned = await client.query(`SELECT 1 FROM auton_path_library_paths WHERE id = $1 AND org_id = $2`, [
    input.pathId,
    input.orgId,
  ]);
  if (!owned.rowCount) throw new Error("Path not found");

  await client.query(
    `INSERT INTO auton_path_library_runs (
       org_id, path_id, outcome, occurred_on, event_label, match_label, notes, logged_by
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8)`,
    [
      input.orgId,
      input.pathId,
      input.outcome,
      input.occurredOn,
      input.eventLabel,
      input.matchLabel,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteRun(
  client: PoolClient,
  input: { orgId: string; runId: string },
): Promise<void> {
  await client.query(`DELETE FROM auton_path_library_runs WHERE id = $1 AND org_id = $2`, [
    input.runId,
    input.orgId,
  ]);
}
