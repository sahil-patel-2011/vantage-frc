import type { PoolClient } from "@neondatabase/serverless";
import { computeDataQualityScorecard, summarizeDataQuality } from ".";
import type { DataQualityCheck, DataQualityScorecard, DataQualityScorecardSummary } from "./types";

export type DataQualitySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type DataQualityScorecardView =
  | {
      status: "setup_required";
      message: string;
      steps: DataQualitySetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      checks: DataQualityCheck[];
      summary: DataQualityScorecardSummary;
      scorecard: DataQualityScorecard;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type CheckRow = {
  id: string;
  eventKey: string;
  matchKey: string | null;
  scoutName: string;
  checkDate: string;
  expectedDataPoints: number;
  capturedDataPoints: number;
  crossChecked: boolean;
  agreement: boolean | null;
  deviationScore: string | number | null;
  seasonYear: number;
  notes: string | null;
};

function mapCheck(row: CheckRow): DataQualityCheck {
  return {
    id: row.id,
    eventKey: row.eventKey,
    matchKey: row.matchKey,
    scoutName: row.scoutName,
    checkDate: row.checkDate,
    expectedDataPoints: Number(row.expectedDataPoints) || 0,
    capturedDataPoints: Number(row.capturedDataPoints) || 0,
    crossChecked: row.crossChecked,
    agreement: row.agreement,
    deviationScore: row.deviationScore === null ? null : Number(row.deviationScore),
    seasonYear: row.seasonYear,
    notes: row.notes,
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

export async function computeDataQualityScorecardView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<DataQualityScorecardView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Choose your team to build the scouting data-quality scorecard.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [checkResult, seasonResult] = await Promise.all([
    client.query<CheckRow>(
      `SELECT id, event_key AS "eventKey", match_key AS "matchKey", scout_name AS "scoutName",
              check_date::text AS "checkDate", expected_data_points AS "expectedDataPoints",
              captured_data_points AS "capturedDataPoints", cross_checked AS "crossChecked",
              agreement, deviation_score AS "deviationScore", season_year AS "seasonYear", notes
       FROM data_quality_scorecard_checks
       WHERE org_id = $1 AND season_year = $2
       ORDER BY check_date DESC, created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM data_quality_scorecard_checks WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  if (checkResult.rows.length === 0) {
    const seasons = seasonResult.rows.map((r) => r.seasonYear);
    if (seasons.length === 0) {
      return {
        status: "setup_required",
        message: "No data-quality checks logged yet for this team. Log a check to start the scorecard.",
        steps: [
          {
            id: "log-check",
            label: "Log a quality check",
            detail: "Record coverage/agreement for a scouted match",
            href: "/data-quality-scorecard",
          },
        ],
        orgId: org.orgId,
        seasonYear,
      };
    }
  }

  const checks = checkResult.rows.map(mapCheck);
  const summary = summarizeDataQuality(checks);
  const scorecard = computeDataQualityScorecard(summary);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    checks,
    summary,
    scorecard,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logCheck(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    eventKey: string;
    matchKey: string | null;
    scoutName: string;
    checkDate: string;
    expectedDataPoints: number;
    capturedDataPoints: number;
    crossChecked: boolean;
    agreement: boolean | null;
    deviationScore: number | null;
    seasonYear: number;
    notes: string | null;
  },
): Promise<void> {
  const captured = Math.min(
    Math.max(0, Math.round(input.capturedDataPoints)),
    Math.max(0, Math.round(input.expectedDataPoints)) || Math.max(0, Math.round(input.capturedDataPoints)),
  );
  await client.query(
    `INSERT INTO data_quality_scorecard_checks (
       org_id, event_key, match_key, scout_name, check_date, expected_data_points,
       captured_data_points, cross_checked, agreement, deviation_score, season_year, notes, logged_by
     ) VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      input.orgId,
      input.eventKey,
      input.matchKey,
      input.scoutName,
      input.checkDate,
      Math.max(0, Math.round(input.expectedDataPoints)),
      captured,
      input.crossChecked,
      input.agreement,
      input.deviationScore,
      input.seasonYear,
      input.notes,
      input.userId,
    ],
  );
}

export async function deleteCheck(client: PoolClient, input: { orgId: string; checkId: string }): Promise<void> {
  await client.query(`DELETE FROM data_quality_scorecard_checks WHERE id = $1 AND org_id = $2`, [
    input.checkId,
    input.orgId,
  ]);
}
