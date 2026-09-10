import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { CHANGE_TYPES, SUBSYSTEMS, correlateChange, summarizeCodePerf } from ".";
import type {
  ChangeType,
  CodePerfChange,
  CodePerfMatchResult,
  CodePerfSummary,
  Subsystem,
} from "./types";

export { CHANGE_TYPES, SUBSYSTEMS };

export type CodePerfSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type CodePerfView =
  | {
      status: "setup_required";
      message: string;
      steps: CodePerfSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      changes: CodePerfChange[];
      matches: CodePerfMatchResult[];
      summary: CodePerfSummary;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isChangeType(value: unknown): value is ChangeType {
  return typeof value === "string" && (CHANGE_TYPES as string[]).includes(value);
}

function isSubsystem(value: unknown): value is Subsystem {
  return typeof value === "string" && (SUBSYSTEMS as string[]).includes(value);
}

type ChangeRow = {
  id: string;
  seasonYear: number;
  occurredOn: string;
  changeType: string;
  subsystem: string;
  title: string;
  commitSha: string | null;
  repoUrl: string | null;
  description: string | null;
  verdict: string;
  deltaAuto: string | null;
  deltaTeleop: string | null;
  deltaTotal: string | null;
  matchesBefore: number;
  matchesAfter: number;
  rationale: string | null;
  analyzedAt: string | null;
  createdAt: string;
};

function mapChange(row: ChangeRow): CodePerfChange {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    occurredOn: row.occurredOn,
    changeType: isChangeType(row.changeType) ? row.changeType : "commit",
    subsystem: isSubsystem(row.subsystem) ? row.subsystem : "general",
    title: row.title,
    commitSha: row.commitSha,
    repoUrl: row.repoUrl,
    description: row.description,
    verdict:
      row.verdict === "improved" || row.verdict === "regressed" || row.verdict === "neutral"
        ? row.verdict
        : "insufficient_data",
    deltaAuto: row.deltaAuto != null ? Number(row.deltaAuto) : null,
    deltaTeleop: row.deltaTeleop != null ? Number(row.deltaTeleop) : null,
    deltaTotal: row.deltaTotal != null ? Number(row.deltaTotal) : null,
    matchesBefore: Number(row.matchesBefore) || 0,
    matchesAfter: Number(row.matchesAfter) || 0,
    rationale: row.rationale,
    analyzedAt: row.analyzedAt,
    createdAt: row.createdAt,
  };
}

type MatchRow = {
  id: string;
  seasonYear: number;
  occurredOn: string;
  matchKey: string;
  eventKey: string | null;
  autoPoints: string;
  teleopPoints: string;
  endgamePoints: string;
  notes: string | null;
  createdAt: string;
};

function mapMatch(row: MatchRow): CodePerfMatchResult {
  const autoPoints = Number(row.autoPoints) || 0;
  const teleopPoints = Number(row.teleopPoints) || 0;
  const endgamePoints = Number(row.endgamePoints) || 0;
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    occurredOn: row.occurredOn,
    matchKey: row.matchKey,
    eventKey: row.eventKey,
    autoPoints,
    teleopPoints,
    endgamePoints,
    totalPoints: autoPoints + teleopPoints + endgamePoints,
    notes: row.notes,
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

export async function computeCodePerfView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<CodePerfView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to correlate code changes against match performance.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [changeResult, matchResult, seasonResult] = await Promise.all([
    client.query<ChangeRow>(
      `SELECT id, season_year AS "seasonYear", occurred_on::text AS "occurredOn", change_type AS "changeType",
              subsystem, title, commit_sha AS "commitSha", repo_url AS "repoUrl", description,
              verdict, delta_auto AS "deltaAuto", delta_teleop AS "deltaTeleop", delta_total AS "deltaTotal",
              matches_before AS "matchesBefore", matches_after AS "matchesAfter", rationale,
              analyzed_at AS "analyzedAt", created_at AS "createdAt"
       FROM code_perf_changes
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<MatchRow>(
      `SELECT id, season_year AS "seasonYear", occurred_on::text AS "occurredOn", match_key AS "matchKey",
              event_key AS "eventKey", auto_points AS "autoPoints", teleop_points AS "teleopPoints",
              endgame_points AS "endgamePoints", notes, created_at AS "createdAt"
       FROM code_perf_match_results
       WHERE org_id = $1 AND season_year = $2
       ORDER BY occurred_on DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM code_perf_changes WHERE org_id = $1
       UNION
       SELECT DISTINCT season_year AS "seasonYear" FROM code_perf_match_results WHERE org_id = $1
       ORDER BY 1 DESC`,
      [org.orgId],
    ),
  ]);

  const changes = changeResult.rows.map(mapChange);
  const matches = matchResult.rows.map(mapMatch);
  const summary = summarizeCodePerf(changes, matches.length);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    changes,
    matches,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logChange(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    occurredOn: string;
    changeType: ChangeType;
    subsystem: Subsystem;
    title: string;
    commitSha: string | null;
    repoUrl: string | null;
    description: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO code_perf_changes (
       org_id, season_year, occurred_on, change_type, subsystem, title, commit_sha, repo_url, description, logged_by
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.orgId,
      input.seasonYear,
      input.occurredOn,
      input.changeType,
      input.subsystem,
      input.title,
      input.commitSha,
      input.repoUrl,
      input.description,
      input.userId,
    ],
  );
}

export async function deleteChange(
  client: PoolClient,
  input: { orgId: string; changeId: string },
): Promise<void> {
  await client.query(`DELETE FROM code_perf_changes WHERE id = $1 AND org_id = $2`, [
    input.changeId,
    input.orgId,
  ]);
}

export async function logMatchResult(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    occurredOn: string;
    matchKey: string;
    eventKey: string | null;
    autoPoints: number;
    teleopPoints: number;
    endgamePoints: number;
    notes: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO code_perf_match_results (
       org_id, season_year, occurred_on, match_key, event_key, auto_points, teleop_points, endgame_points, notes, logged_by
     ) VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (org_id, match_key) DO UPDATE SET
       season_year = EXCLUDED.season_year,
       occurred_on = EXCLUDED.occurred_on,
       event_key = EXCLUDED.event_key,
       auto_points = EXCLUDED.auto_points,
       teleop_points = EXCLUDED.teleop_points,
       endgame_points = EXCLUDED.endgame_points,
       notes = EXCLUDED.notes`,
    [
      input.orgId,
      input.seasonYear,
      input.occurredOn,
      input.matchKey,
      input.eventKey,
      input.autoPoints,
      input.teleopPoints,
      input.endgamePoints,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteMatchResult(
  client: PoolClient,
  input: { orgId: string; matchResultId: string },
): Promise<void> {
  await client.query(`DELETE FROM code_perf_match_results WHERE id = $1 AND org_id = $2`, [
    input.matchResultId,
    input.orgId,
  ]);
}

/**
 * Computes the before/after correlation locally (deterministic, grounded only in the org's own
 * logged match results) then meters the write through the standard AI-usage path — matching the
 * local/deterministic metering pattern used for other zero-provider-cost computed briefs. No
 * external model call, no fabricated data.
 */
export async function analyzeChange(
  client: PoolClient,
  input: { orgId: string; userId: string; changeId: string },
): Promise<void> {
  const changeRow = await client.query<{ occurredOn: string; seasonYear: number }>(
    `SELECT occurred_on::text AS "occurredOn", season_year AS "seasonYear"
     FROM code_perf_changes WHERE id = $1 AND org_id = $2`,
    [input.changeId, input.orgId],
  );
  const change = changeRow.rows[0];
  if (!change) throw new Error("Change not found");

  const matchRows = await client.query<MatchRow>(
    `SELECT id, season_year AS "seasonYear", occurred_on::text AS "occurredOn", match_key AS "matchKey",
            event_key AS "eventKey", auto_points AS "autoPoints", teleop_points AS "teleopPoints",
            endgame_points AS "endgamePoints", notes, created_at AS "createdAt"
     FROM code_perf_match_results
     WHERE org_id = $1 AND season_year = $2`,
    [input.orgId, change.seasonYear],
  );
  const matches = matchRows.rows.map(mapMatch);

  const correlation = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "code_perf",
    requestId: `code-perf-analyze-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      changeId: input.changeId,
      seasonYear: change.seasonYear,
      note: "Deterministic before/after match-window correlation — no external model call",
    },
    invoke: async () => ({
      value: correlateChange({ occurredOn: change.occurredOn }, matches),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-code-perf-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `UPDATE code_perf_changes SET
       verdict = $1, delta_auto = $2, delta_teleop = $3, delta_total = $4,
       matches_before = $5, matches_after = $6, rationale = $7, analyzed_at = now()
     WHERE id = $8 AND org_id = $9`,
    [
      correlation.verdict,
      correlation.deltaAuto,
      correlation.deltaTeleop,
      correlation.deltaTotal,
      correlation.matchesBefore,
      correlation.matchesAfter,
      correlation.rationale,
      input.changeId,
      input.orgId,
    ],
  );
}
