import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { REUSE_ASSESSMENT_STATUSES, REUSE_RECOMMENDATIONS, SUBSYSTEM_CATEGORIES, assessReuse } from ".";
import type {
  ReuseAssessment,
  ReuseAssessmentStatus,
  ReuseCandidate,
  ReuseRecommendation,
  SubsystemCategory,
} from "./types";

export { REUSE_ASSESSMENT_STATUSES, REUSE_RECOMMENDATIONS, SUBSYSTEM_CATEGORIES };

export type ReuseAdvisorSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ReuseAdvisorView =
  | {
      status: "setup_required";
      message: string;
      steps: ReuseAdvisorSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      candidates: ReuseCandidate[];
      assessments: ReuseAssessment[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isCategory(value: unknown): value is SubsystemCategory {
  return typeof value === "string" && (SUBSYSTEM_CATEGORIES as string[]).includes(value);
}

function isRecommendation(value: unknown): value is ReuseRecommendation {
  return typeof value === "string" && (REUSE_RECOMMENDATIONS as string[]).includes(value);
}

function isStatus(value: unknown): value is ReuseAssessmentStatus {
  return typeof value === "string" && (REUSE_ASSESSMENT_STATUSES as string[]).includes(value);
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

type SubsystemRow = {
  id: string;
  name: string;
  category: SubsystemCategory;
  seasonYear: number;
  motorType: string;
  motorCount: number | null;
};

type HistoryAggRow = {
  key: string;
  total: string;
  highSeverityOrPassed: string;
};

type AssessedRow = { subsystemName: string };

type AssessmentRow = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  category: SubsystemCategory;
  sourceSubsystemId: string | null;
  sourceSeasonYear: number | null;
  fmeaFailureCount: number;
  fmeaHighSeverityCount: number;
  designReviewCount: number;
  designReviewPassCount: number;
  recommendation: string;
  confidence: string | number;
  rationale: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapAssessment(row: AssessmentRow): ReuseAssessment {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystemName: row.subsystemName,
    category: isCategory(row.category) ? row.category : "other",
    sourceSubsystemId: row.sourceSubsystemId,
    sourceSeasonYear: row.sourceSeasonYear,
    fmeaFailureCount: Number(row.fmeaFailureCount) || 0,
    fmeaHighSeverityCount: Number(row.fmeaHighSeverityCount) || 0,
    designReviewCount: Number(row.designReviewCount) || 0,
    designReviewPassCount: Number(row.designReviewPassCount) || 0,
    recommendation: isRecommendation(row.recommendation) ? row.recommendation : "modify",
    confidence: Number(row.confidence) || 0,
    rationale: row.rationale,
    status: isStatus(row.status) ? row.status : "open",
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function computeReuseAdvisorView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<ReuseAdvisorView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to get cross-season subsystem reuse recommendations.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
        {
          id: "subsystems",
          label: "Log robot subsystems",
          detail: "Add prior-season subsystems on the Build spec sheet",
          href: "/build",
        },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [subsystemResult, fmeaResult, reviewResult, assessedResult, assessmentResult, seasonResult] =
    await Promise.all([
      client.query<SubsystemRow>(
        `SELECT DISTINCT ON (lower(name)) id, name, category, season_year AS "seasonYear",
                motor_type AS "motorType", motor_count AS "motorCount"
         FROM robot_subsystems
         WHERE org_id = $1 AND season_year < $2
         ORDER BY lower(name), season_year DESC`,
        [org.orgId, seasonYear],
      ),
      client.query<HistoryAggRow>(
        `SELECT lower(subsystem_name) AS key, count(*)::text AS total,
                count(*) FILTER (WHERE severity >= 7)::text AS "highSeverityOrPassed"
         FROM fmea_failures
         WHERE org_id = $1 AND season_year < $2
         GROUP BY lower(subsystem_name)`,
        [org.orgId, seasonYear],
      ),
      client.query<HistoryAggRow>(
        `SELECT lower(subsystem) AS key, count(*)::text AS total,
                count(*) FILTER (WHERE status = 'complete')::text AS "highSeverityOrPassed"
         FROM design_reviews
         WHERE org_id = $1 AND season_year < $2
         GROUP BY lower(subsystem)`,
        [org.orgId, seasonYear],
      ),
      client.query<AssessedRow>(
        `SELECT DISTINCT lower(subsystem_name) AS "subsystemName"
         FROM reuse_advisor_assessments
         WHERE org_id = $1 AND season_year = $2`,
        [org.orgId, seasonYear],
      ),
      client.query<AssessmentRow>(
        `SELECT id, season_year AS "seasonYear", subsystem_name AS "subsystemName", category,
                source_subsystem_id AS "sourceSubsystemId", source_season_year AS "sourceSeasonYear",
                fmea_failure_count AS "fmeaFailureCount", fmea_high_severity_count AS "fmeaHighSeverityCount",
                design_review_count AS "designReviewCount", design_review_pass_count AS "designReviewPassCount",
                recommendation, confidence, rationale, status, notes,
                created_at AS "createdAt", updated_at AS "updatedAt"
         FROM reuse_advisor_assessments
         WHERE org_id = $1 AND season_year = $2
         ORDER BY created_at DESC`,
        [org.orgId, seasonYear],
      ),
      client.query<{ seasonYear: number }>(
        `SELECT DISTINCT season_year AS "seasonYear" FROM robot_subsystems WHERE org_id = $1 ORDER BY season_year DESC`,
        [org.orgId],
      ),
    ]);

  const fmeaByName = new Map<string, { total: number; highSeverity: number }>();
  for (const row of fmeaResult.rows) {
    fmeaByName.set(row.key, { total: Number(row.total) || 0, highSeverity: Number(row.highSeverityOrPassed) || 0 });
  }
  const reviewsByName = new Map<string, { total: number; passed: number }>();
  for (const row of reviewResult.rows) {
    reviewsByName.set(row.key, { total: Number(row.total) || 0, passed: Number(row.highSeverityOrPassed) || 0 });
  }
  const assessedNames = new Set(assessedResult.rows.map((row) => row.subsystemName));

  const candidates: ReuseCandidate[] = subsystemResult.rows.map((row) => {
    const key = row.name.toLowerCase();
    const fmea = fmeaByName.get(key) ?? { total: 0, highSeverity: 0 };
    const reviews = reviewsByName.get(key) ?? { total: 0, passed: 0 };
    const result = assessReuse({
      fmeaFailureCount: fmea.total,
      fmeaHighSeverityCount: fmea.highSeverity,
      designReviewCount: reviews.total,
      designReviewPassCount: reviews.passed,
    });
    return {
      subsystemId: row.id,
      subsystemName: row.name,
      category: isCategory(row.category) ? row.category : "other",
      sourceSeasonYear: row.seasonYear,
      motorType: row.motorType,
      motorCount: row.motorCount,
      fmeaFailureCount: fmea.total,
      fmeaHighSeverityCount: fmea.highSeverity,
      designReviewCount: reviews.total,
      designReviewPassCount: reviews.passed,
      recommendation: result.recommendation,
      confidence: result.confidence,
      rationale: result.rationale,
      alreadyAssessed: assessedNames.has(key),
    };
  });

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    candidates,
    assessments: assessmentResult.rows.map(mapAssessment),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function recordAssessment(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    subsystemId: string | null;
    subsystemName: string;
    category: SubsystemCategory;
    sourceSeasonYear: number | null;
    notes: string | null;
  },
): Promise<void> {
  const [fmeaResult, reviewResult] = await Promise.all([
    client.query<{ total: string; highSeverity: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE severity >= 7)::text AS "highSeverity"
       FROM fmea_failures
       WHERE org_id = $1 AND season_year < $2 AND lower(subsystem_name) = lower($3)`,
      [input.orgId, input.seasonYear, input.subsystemName],
    ),
    client.query<{ total: string; passed: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE status = 'complete')::text AS passed
       FROM design_reviews
       WHERE org_id = $1 AND season_year < $2 AND lower(subsystem) = lower($3)`,
      [input.orgId, input.seasonYear, input.subsystemName],
    ),
  ]);

  const fmeaFailureCount = Number(fmeaResult.rows[0]?.total ?? 0) || 0;
  const fmeaHighSeverityCount = Number(fmeaResult.rows[0]?.highSeverity ?? 0) || 0;
  const designReviewCount = Number(reviewResult.rows[0]?.total ?? 0) || 0;
  const designReviewPassCount = Number(reviewResult.rows[0]?.passed ?? 0) || 0;

  const assessment = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "reuse_advisor",
    requestId: `reuse-advisor-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      subsystemName: input.subsystemName,
      seasonYear: input.seasonYear,
      note: "Deterministic FMEA-history/design-review reuse computation — no external model call",
    },
    invoke: async () => ({
      value: assessReuse({
        fmeaFailureCount,
        fmeaHighSeverityCount,
        designReviewCount,
        designReviewPassCount,
      }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-reuse-advisor-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO reuse_advisor_assessments (
       org_id, season_year, subsystem_name, category, source_subsystem_id, source_season_year,
       fmea_failure_count, fmea_high_severity_count, design_review_count, design_review_pass_count,
       recommendation, confidence, rationale, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.orgId,
      input.seasonYear,
      input.subsystemName,
      input.category,
      input.subsystemId,
      input.sourceSeasonYear,
      fmeaFailureCount,
      fmeaHighSeverityCount,
      designReviewCount,
      designReviewPassCount,
      assessment.recommendation,
      assessment.confidence,
      assessment.rationale,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateAssessmentStatus(
  client: PoolClient,
  input: { orgId: string; assessmentId: string; status: ReuseAssessmentStatus },
): Promise<void> {
  await client.query(
    `UPDATE reuse_advisor_assessments SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.assessmentId, input.orgId],
  );
}

export async function deleteAssessment(
  client: PoolClient,
  input: { orgId: string; assessmentId: string },
): Promise<void> {
  await client.query(`DELETE FROM reuse_advisor_assessments WHERE id = $1 AND org_id = $2`, [
    input.assessmentId,
    input.orgId,
  ]);
}
