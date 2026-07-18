import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import {
  RULE_CHANGE_CATEGORIES,
  RULE_CHANGE_SEVERITIES,
  RULE_IMPACT_ASSESSMENT_STATUSES,
  SUBSYSTEM_CATEGORIES,
  assessRuleImpact,
} from ".";
import type {
  RuleChange,
  RuleChangeCategory,
  RuleChangeSeverity,
  RuleImpactAssessment,
  RuleImpactAssessmentStatus,
  RuleImpactCandidate,
  RuleImpactStatus,
  SubsystemCategory,
} from "./types";

export { RULE_CHANGE_CATEGORIES, RULE_CHANGE_SEVERITIES, RULE_IMPACT_ASSESSMENT_STATUSES, SUBSYSTEM_CATEGORIES };

export type RuleImpactSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type RuleImpactView =
  | {
      status: "setup_required";
      message: string;
      steps: RuleImpactSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      ruleChanges: RuleChange[];
      candidates: RuleImpactCandidate[];
      assessments: RuleImpactAssessment[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isCategory(value: unknown): value is SubsystemCategory {
  return typeof value === "string" && (SUBSYSTEM_CATEGORIES as string[]).includes(value);
}

function isRuleChangeCategory(value: unknown): value is RuleChangeCategory {
  return typeof value === "string" && (RULE_CHANGE_CATEGORIES as string[]).includes(value);
}

function isSeverity(value: unknown): value is RuleChangeSeverity {
  return typeof value === "string" && (RULE_CHANGE_SEVERITIES as string[]).includes(value);
}

function isAssessmentStatus(value: unknown): value is RuleImpactAssessmentStatus {
  return typeof value === "string" && (RULE_IMPACT_ASSESSMENT_STATUSES as string[]).includes(value);
}

function isImpactStatus(value: unknown): value is RuleImpactStatus {
  return value === "still_legal" || value === "needs_rework" || value === "blocked";
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

type RuleChangeRow = {
  id: string;
  seasonYear: number;
  ruleCode: string;
  title: string;
  category: RuleChangeCategory;
  severity: RuleChangeSeverity;
  subsystemCategory: SubsystemCategory | null;
  summary: string;
  sourceUrl: string | null;
  createdAt: string;
};

type AssessedRow = { subsystemName: string };

type AssessmentRow = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  category: SubsystemCategory;
  sourceSubsystemId: string | null;
  sourceSeasonYear: number | null;
  matchedRuleCount: number;
  blockingRuleCount: number;
  majorRuleCount: number;
  impactStatus: string;
  confidence: string | number;
  rationale: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapRuleChange(row: RuleChangeRow): RuleChange {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    ruleCode: row.ruleCode,
    title: row.title,
    category: isRuleChangeCategory(row.category) ? row.category : "other",
    severity: isSeverity(row.severity) ? row.severity : "minor",
    subsystemCategory: isCategory(row.subsystemCategory) ? row.subsystemCategory : null,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    createdAt: row.createdAt,
  };
}

function mapAssessment(row: AssessmentRow): RuleImpactAssessment {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystemName: row.subsystemName,
    category: isCategory(row.category) ? row.category : "other",
    sourceSubsystemId: row.sourceSubsystemId,
    sourceSeasonYear: row.sourceSeasonYear,
    matchedRuleCount: Number(row.matchedRuleCount) || 0,
    blockingRuleCount: Number(row.blockingRuleCount) || 0,
    majorRuleCount: Number(row.majorRuleCount) || 0,
    impactStatus: isImpactStatus(row.impactStatus) ? row.impactStatus : "needs_rework",
    confidence: Number(row.confidence) || 0,
    rationale: row.rationale,
    status: isAssessmentStatus(row.status) ? row.status : "open",
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Rule changes that apply to a subsystem category: category-specific ones, plus general (null-category) ones. */
function matchingRules(ruleChanges: RuleChange[], category: SubsystemCategory): RuleChange[] {
  return ruleChanges.filter((rule) => rule.subsystemCategory === category || rule.subsystemCategory === null);
}

export async function computeRuleImpactView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<RuleImpactView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to analyze rule-change impact against your subsystem library.",
      steps: [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Rule Impact is org-scoped — pick a team before logging game-manual deltas.",
          href: "/workspace",
        },
        {
          id: "kickoff",
          label: "Open Kickoff",
          detail: "Rule notes stay blank until answered — never DEMO rule text.",
          href: "/build?tab=kickoff",
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Mechanism geometry stays blank until connected — never DEMO models.",
          href: "/build?tab=cad",
        },
        {
          id: "subsystems",
          label: "Open Subsystems",
          detail: "Prior-season mechanisms stay empty until you author them — never DEMO systems.",
          href: "/subsystems",
        },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [subsystemResult, ruleChangeResult, assessedResult, assessmentResult, seasonResult] = await Promise.all([
    client.query<SubsystemRow>(
      `SELECT DISTINCT ON (lower(name)) id, name, category, season_year AS "seasonYear",
              motor_type AS "motorType", motor_count AS "motorCount"
       FROM robot_subsystems
       WHERE org_id = $1 AND season_year < $2
       ORDER BY lower(name), season_year DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<RuleChangeRow>(
      `SELECT id, season_year AS "seasonYear", rule_code AS "ruleCode", title, category, severity,
              subsystem_category AS "subsystemCategory", summary, source_url AS "sourceUrl",
              created_at AS "createdAt"
       FROM rule_impact_rule_changes
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<AssessedRow>(
      `SELECT DISTINCT lower(subsystem_name) AS "subsystemName"
       FROM rule_impact_assessments
       WHERE org_id = $1 AND season_year = $2`,
      [org.orgId, seasonYear],
    ),
    client.query<AssessmentRow>(
      `SELECT id, season_year AS "seasonYear", subsystem_name AS "subsystemName", category,
              source_subsystem_id AS "sourceSubsystemId", source_season_year AS "sourceSeasonYear",
              matched_rule_count AS "matchedRuleCount", blocking_rule_count AS "blockingRuleCount",
              major_rule_count AS "majorRuleCount", impact_status AS "impactStatus", confidence,
              rationale, status, notes, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM rule_impact_assessments
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM robot_subsystems WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const ruleChanges = ruleChangeResult.rows.map(mapRuleChange);
  const assessedNames = new Set(assessedResult.rows.map((row) => row.subsystemName));

  const candidates: RuleImpactCandidate[] = subsystemResult.rows.map((row) => {
    const category = isCategory(row.category) ? row.category : "other";
    const matched = matchingRules(ruleChanges, category);
    const blockingRuleCount = matched.filter((rule) => rule.severity === "blocking").length;
    const majorRuleCount = matched.filter((rule) => rule.severity === "major").length;
    const result = assessRuleImpact({
      matchedRuleCount: matched.length,
      blockingRuleCount,
      majorRuleCount,
    });
    return {
      subsystemId: row.id,
      subsystemName: row.name,
      category,
      sourceSeasonYear: row.seasonYear,
      motorType: row.motorType,
      motorCount: row.motorCount,
      matchedRuleCount: matched.length,
      blockingRuleCount,
      majorRuleCount,
      matchedRules: matched.map((rule) => ({
        id: rule.id,
        ruleCode: rule.ruleCode,
        title: rule.title,
        severity: rule.severity,
      })),
      impactStatus: result.status,
      confidence: result.confidence,
      rationale: result.rationale,
      alreadyAssessed: assessedNames.has(row.name.toLowerCase()),
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
    ruleChanges,
    candidates,
    assessments: assessmentResult.rows.map(mapAssessment),
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logRuleChange(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    ruleCode: string;
    title: string;
    category: RuleChangeCategory;
    severity: RuleChangeSeverity;
    subsystemCategory: SubsystemCategory | null;
    summary: string;
    sourceUrl: string | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO rule_impact_rule_changes (
       org_id, season_year, rule_code, title, category, severity, subsystem_category, summary, source_url, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      input.orgId,
      input.seasonYear,
      input.ruleCode,
      input.title,
      input.category,
      input.severity,
      input.subsystemCategory,
      input.summary,
      input.sourceUrl,
      input.userId,
    ],
  );
}

export async function deleteRuleChange(
  client: PoolClient,
  input: { orgId: string; ruleChangeId: string },
): Promise<void> {
  await client.query(`DELETE FROM rule_impact_rule_changes WHERE id = $1 AND org_id = $2`, [
    input.ruleChangeId,
    input.orgId,
  ]);
}

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
  const ruleResult = await client.query<{ severity: RuleChangeSeverity; subsystemCategory: SubsystemCategory | null }>(
    `SELECT severity, subsystem_category AS "subsystemCategory"
     FROM rule_impact_rule_changes
     WHERE org_id = $1 AND season_year = $2`,
    [input.orgId, input.seasonYear],
  );
  const matched = ruleResult.rows.filter(
    (row) => row.subsystemCategory === input.category || row.subsystemCategory === null,
  );
  const matchedRuleCount = matched.length;
  const blockingRuleCount = matched.filter((row) => row.severity === "blocking").length;
  const majorRuleCount = matched.filter((row) => row.severity === "major").length;

  const assessment = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "rule_impact",
    requestId: `rule-impact-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      subsystemName: input.subsystemName,
      seasonYear: input.seasonYear,
      note: "Deterministic rule-change-match computation — no external model call",
    },
    invoke: async () => ({
      value: assessRuleImpact({ matchedRuleCount, blockingRuleCount, majorRuleCount }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-rule-impact-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO rule_impact_assessments (
       org_id, season_year, subsystem_name, category, source_subsystem_id, source_season_year,
       matched_rule_count, blocking_rule_count, major_rule_count,
       impact_status, confidence, rationale, notes, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [
      input.orgId,
      input.seasonYear,
      input.subsystemName,
      input.category,
      input.subsystemId,
      input.sourceSeasonYear,
      matchedRuleCount,
      blockingRuleCount,
      majorRuleCount,
      assessment.status,
      assessment.confidence,
      assessment.rationale,
      input.notes,
      input.userId,
    ],
  );
}

export async function updateAssessmentStatus(
  client: PoolClient,
  input: { orgId: string; assessmentId: string; status: RuleImpactAssessmentStatus },
): Promise<void> {
  await client.query(
    `UPDATE rule_impact_assessments SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.status, input.assessmentId, input.orgId],
  );
}

export async function deleteAssessment(
  client: PoolClient,
  input: { orgId: string; assessmentId: string },
): Promise<void> {
  await client.query(`DELETE FROM rule_impact_assessments WHERE id = $1 AND org_id = $2`, [
    input.assessmentId,
    input.orgId,
  ]);
}
