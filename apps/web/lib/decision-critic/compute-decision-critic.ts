import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { DECISION_CRITIC_CATEGORIES, DECISION_CRITIC_OUTCOMES, DECISION_CRITIC_VERDICTS, critiqueDecision } from ".";
import type {
  DecisionCriticCategory,
  DecisionCriticOutcome,
  DecisionCriticReview,
  DecisionCriticVerdict,
  FmeaMatch,
  PowerHeadroom,
  PriorDecisionMatch,
  WeightHeadroom,
} from "./types";

export { DECISION_CRITIC_CATEGORIES, DECISION_CRITIC_OUTCOMES, DECISION_CRITIC_VERDICTS };

export type DecisionCriticSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type DecisionCriticView =
  | {
      status: "setup_required";
      message: string;
      steps: DecisionCriticSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      reviews: DecisionCriticReview[];
      weightHeadroom: WeightHeadroom;
      powerHeadroom: PowerHeadroom;
      recentDecisions: PriorDecisionMatch[];
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isVerdict(value: unknown): value is DecisionCriticVerdict {
  return typeof value === "string" && (DECISION_CRITIC_VERDICTS as string[]).includes(value);
}

function isOutcome(value: unknown): value is DecisionCriticOutcome {
  return typeof value === "string" && (DECISION_CRITIC_OUTCOMES as string[]).includes(value);
}

function isCategory(value: unknown): value is DecisionCriticCategory {
  return typeof value === "string" && (DECISION_CRITIC_CATEGORIES as readonly string[]).includes(value);
}

type ReviewRow = {
  id: string;
  seasonYear: number;
  subsystemName: string;
  title: string;
  proposal: string;
  category: string;
  weightAddedLbs: string;
  weightMarginLbs: string;
  powerAddedAmps: string;
  powerHeadroomAmps: string;
  chronicFailureCount: number;
  priorRejectedCount: number;
  verdict: string;
  confidence: string;
  concerns: string[] | null;
  recommendation: string;
  relatedFmeaFailureIds: string[] | null;
  relatedDecisionIds: string[] | null;
  outcome: string;
  createdAt: string;
  updatedAt: string;
};

function mapReview(row: ReviewRow): DecisionCriticReview {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    subsystemName: row.subsystemName,
    title: row.title,
    proposal: row.proposal,
    category: isCategory(row.category) ? row.category : "design",
    weightAddedLbs: Number(row.weightAddedLbs) || 0,
    weightMarginLbs: Number(row.weightMarginLbs) || 0,
    powerAddedAmps: Number(row.powerAddedAmps) || 0,
    powerHeadroomAmps: Number(row.powerHeadroomAmps) || 0,
    chronicFailureCount: Number(row.chronicFailureCount) || 0,
    priorRejectedCount: Number(row.priorRejectedCount) || 0,
    verdict: isVerdict(row.verdict) ? row.verdict : "proceed_with_caution",
    confidence: Number(row.confidence) || 0,
    concerns: Array.isArray(row.concerns) ? row.concerns : [],
    recommendation: row.recommendation,
    relatedFmeaFailureIds: Array.isArray(row.relatedFmeaFailureIds) ? row.relatedFmeaFailureIds : [],
    relatedDecisionIds: Array.isArray(row.relatedDecisionIds) ? row.relatedDecisionIds : [],
    outcome: isOutcome(row.outcome) ? row.outcome : "open",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

async function loadWeightHeadroom(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<WeightHeadroom> {
  const [totalResult, limitResult] = await Promise.all([
    client.query<{ total: string }>(
      `SELECT COALESCE(SUM(weight_lbs * quantity), 0)::text AS total
       FROM weight_components WHERE org_id = $1 AND season_year = $2`,
      [orgId, seasonYear],
    ),
    client.query<{ limitLbs: string }>(
      `SELECT limit_lbs::text AS "limitLbs" FROM weight_settings WHERE org_id = $1 AND season_year = $2`,
      [orgId, seasonYear],
    ),
  ]);
  const totalLbs = Number(totalResult.rows[0]?.total ?? 0) || 0;
  const limitLbs = Number(limitResult.rows[0]?.limitLbs ?? 125) || 125;
  return { totalLbs, limitLbs, marginLbs: Math.round((limitLbs - totalLbs) * 100) / 100 };
}

async function loadPowerHeadroom(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<PowerHeadroom> {
  const result = await client.query<{ totalPeak: string; totalBreaker: string }>(
    `SELECT COALESCE(SUM(peak_amps), 0)::text AS "totalPeak", COALESCE(SUM(breaker_amps), 0)::text AS "totalBreaker"
     FROM power_loads WHERE org_id = $1 AND season_year = $2`,
    [orgId, seasonYear],
  );
  const totalPeakAmps = Number(result.rows[0]?.totalPeak ?? 0) || 0;
  const totalBreakerAmps = Number(result.rows[0]?.totalBreaker ?? 0) || 0;
  return {
    totalPeakAmps,
    totalBreakerAmps,
    headroomAmps: Math.round((totalBreakerAmps - totalPeakAmps) * 100) / 100,
  };
}

async function loadRecentDecisions(
  client: PoolClient,
  orgId: string,
  seasonYear: number,
): Promise<PriorDecisionMatch[]> {
  const result = await client.query<{
    id: string;
    title: string;
    status: string;
    decidedOn: string | null;
    rationale: string | null;
  }>(
    `SELECT id, title, status, decided_on::text AS "decidedOn", rationale
     FROM decision_records
     WHERE org_id = $1 AND season_year = $2
     ORDER BY created_at DESC
     LIMIT 20`,
    [orgId, seasonYear],
  );
  return result.rows;
}

export async function computeDecisionCriticView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<DecisionCriticView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to get a second opinion on design decisions.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [reviewResult, seasonResult, weightHeadroom, powerHeadroom, recentDecisions] = await Promise.all([
    client.query<ReviewRow>(
      `SELECT id, season_year AS "seasonYear", subsystem_name AS "subsystemName", title, proposal, category,
              weight_added_lbs AS "weightAddedLbs", weight_margin_lbs AS "weightMarginLbs",
              power_added_amps AS "powerAddedAmps", power_headroom_amps AS "powerHeadroomAmps",
              chronic_failure_count AS "chronicFailureCount", prior_rejected_count AS "priorRejectedCount",
              verdict, confidence, concerns, recommendation,
              related_fmea_failure_ids AS "relatedFmeaFailureIds", related_decision_ids AS "relatedDecisionIds",
              outcome, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM decision_critic_reviews
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM decision_critic_reviews WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    loadWeightHeadroom(client, org.orgId, seasonYear),
    loadPowerHeadroom(client, org.orgId, seasonYear),
    loadRecentDecisions(client, org.orgId, seasonYear),
  ]);

  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    reviews: reviewResult.rows.map(mapReview),
    weightHeadroom,
    powerHeadroom,
    recentDecisions,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logReview(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    subsystemName: string;
    title: string;
    proposal: string;
    category: DecisionCriticCategory;
    weightAddedLbs: number;
    powerAddedAmps: number;
  },
): Promise<void> {
  const [weightHeadroom, powerHeadroom, fmeaResult, decisionResult] = await Promise.all([
    loadWeightHeadroom(client, input.orgId, input.seasonYear),
    loadPowerHeadroom(client, input.orgId, input.seasonYear),
    client.query<FmeaMatch>(
      `SELECT id, title, subsystem_name AS "subsystemName", occurred_at::text AS "occurredAt",
              severity, occurrence, detection, status
       FROM fmea_failures
       WHERE org_id = $1 AND lower(subsystem_name) = lower($2)
       ORDER BY occurred_at DESC
       LIMIT 20`,
      [input.orgId, input.subsystemName],
    ),
    client.query<{ id: string }>(
      `SELECT id FROM decision_records
       WHERE org_id = $1 AND status IN ('rejected', 'superseded') AND (title ILIKE $2 OR context ILIKE $2)
       ORDER BY created_at DESC
       LIMIT 10`,
      [input.orgId, `%${input.subsystemName}%`],
    ),
  ]);

  const chronicFailureCount = fmeaResult.rows.length;
  const priorRejectedCount = decisionResult.rows.length;
  const relatedFmeaFailureIds = fmeaResult.rows.map((r) => r.id);
  const relatedDecisionIds = decisionResult.rows.map((r) => r.id);

  const critique = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "decision_critic",
    requestId: `decision-critic-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      subsystemName: input.subsystemName,
      seasonYear: input.seasonYear,
      note: "Deterministic weight/power-headroom + FMEA-history + prior-decision critique — no external model call",
    },
    invoke: async () => ({
      value: critiqueDecision({
        weightAddedLbs: input.weightAddedLbs,
        weightMarginLbs: weightHeadroom.marginLbs,
        powerAddedAmps: input.powerAddedAmps,
        powerHeadroomAmps: powerHeadroom.headroomAmps,
        chronicFailureCount,
        priorRejectedCount,
      }),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-decision-critic-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO decision_critic_reviews (
       org_id, season_year, subsystem_name, title, proposal, category,
       weight_added_lbs, weight_margin_lbs, power_added_amps, power_headroom_amps,
       chronic_failure_count, prior_rejected_count, verdict, confidence, concerns, recommendation,
       related_fmea_failure_ids, related_decision_ids, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::text[],$16,$17::text[],$18::text[],$19)`,
    [
      input.orgId,
      input.seasonYear,
      input.subsystemName,
      input.title,
      input.proposal,
      input.category,
      Math.max(0, input.weightAddedLbs),
      weightHeadroom.marginLbs,
      Math.max(0, input.powerAddedAmps),
      powerHeadroom.headroomAmps,
      chronicFailureCount,
      priorRejectedCount,
      critique.verdict,
      critique.confidence,
      critique.concerns,
      critique.recommendation,
      relatedFmeaFailureIds,
      relatedDecisionIds,
      input.userId,
    ],
  );
}

export async function updateReviewOutcome(
  client: PoolClient,
  input: { orgId: string; reviewId: string; outcome: DecisionCriticOutcome },
): Promise<void> {
  await client.query(
    `UPDATE decision_critic_reviews SET outcome = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
    [input.outcome, input.reviewId, input.orgId],
  );
}

export async function deleteReview(
  client: PoolClient,
  input: { orgId: string; reviewId: string },
): Promise<void> {
  await client.query(`DELETE FROM decision_critic_reviews WHERE id = $1 AND org_id = $2`, [
    input.reviewId,
    input.orgId,
  ]);
}
