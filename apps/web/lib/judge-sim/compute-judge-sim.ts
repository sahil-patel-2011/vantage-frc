import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import {
  loadMediaEvidenceReferences,
  type MediaEvidenceReference,
} from "../media/evidence-references";
import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { JUDGE_SIM_CATEGORIES, gradeAnswer, pickJudgeQuestion } from ".";
import type {
  JudgeSimCategory,
  JudgeSimEvidence,
  JudgeSimReadiness,
  JudgeSimSession,
  JudgeSimVerdict,
} from "./types";

export { JUDGE_SIM_CATEGORIES };

export type JudgeSimSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO judge metrics. */
function setupStepsFor(orgId: string | null): JudgeSimSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Judge-Pitch.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "impact",
      label: "Open Community Impact",
      detail: "Outreach claims stay blank until real activities exist.",
      href: hubHref("/business", "impact", orgId),
    },
    {
      id: "impact-essay",
      label: "Open Impact Essay",
      detail: "Essay drafts stay empty until real impact rows exist.",
      href: hubHref("/business", "impact-essay", orgId),
    },
    {
      id: "evidence",
      label: "Open Awards",
      detail: "Award packets stay blank until your team uploads evidence.",
      href: hubHref("/business", "evidence", orgId),
    },
  ];
}

export type JudgeSimView =
  | {
      status: "setup_required";
      message: string;
      steps: JudgeSimSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      evidence: JudgeSimEvidence[];
      evidenceLibrary: MediaEvidenceReference[];
      sessions: JudgeSimSession[];
      readiness: JudgeSimReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isCategory(value: unknown): value is JudgeSimCategory {
  return typeof value === "string" && (JUDGE_SIM_CATEGORIES as string[]).includes(value);
}

function isVerdict(value: unknown): value is JudgeSimVerdict {
  return value === "well_backed" || value === "partially_backed" || value === "unbacked";
}

type EvidenceRow = {
  id: string;
  title: string;
  claim: string;
  category: string;
  sourceUrl: string | null;
  occurredOn: string | null;
  tags: string[] | null;
  createdAt: string;
};

function mapEvidence(row: EvidenceRow): JudgeSimEvidence {
  return {
    id: row.id,
    title: row.title,
    claim: row.claim,
    category: isCategory(row.category) ? row.category : "technical",
    sourceUrl: row.sourceUrl,
    occurredOn: row.occurredOn,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.createdAt,
  };
}

type SessionRow = {
  id: string;
  seasonYear: number;
  category: string;
  question: string;
  answerText: string;
  verdict: string;
  confidence: string;
  backedClaims: string[] | null;
  flaggedClaims: string[] | null;
  matchedEvidenceIds: string[] | null;
  feedback: string;
  createdAt: string;
};

function mapSession(row: SessionRow): JudgeSimSession {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    category: isCategory(row.category) ? row.category : "technical",
    question: row.question,
    answerText: row.answerText,
    verdict: isVerdict(row.verdict) ? row.verdict : "unbacked",
    confidence: Number(row.confidence) || 0,
    backedClaims: Array.isArray(row.backedClaims) ? row.backedClaims : [],
    flaggedClaims: Array.isArray(row.flaggedClaims) ? row.flaggedClaims : [],
    matchedEvidenceIds: Array.isArray(row.matchedEvidenceIds) ? row.matchedEvidenceIds : [],
    feedback: row.feedback,
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

function computeReadiness(sessions: JudgeSimSession[], evidenceCount: number): JudgeSimReadiness {
  const totalSessions = sessions.length;
  const wellBackedCount = sessions.filter((s) => s.verdict === "well_backed").length;
  const unbackedCount = sessions.filter((s) => s.verdict === "unbacked").length;
  const score = totalSessions > 0 ? Math.round((wellBackedCount / totalSessions) * 1000) / 1000 : 0;
  return { score, totalSessions, wellBackedCount, unbackedCount, evidenceCount };
}

export async function computeJudgeSimView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<JudgeSimView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message:
        "Select a team to practice judge Q&A grounded in your own logged evidence.",
      steps: setupStepsFor(null),
      orgId: null,
      seasonYear,
    };
  }

  const [evidenceResult, sessionResult, seasonResult, evidenceLibrary] = await Promise.all([
    client.query<EvidenceRow>(
      `SELECT id, title, claim, category, source_url AS "sourceUrl", occurred_on::text AS "occurredOn",
              tags, created_at AS "createdAt"
       FROM judge_sim_evidence
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [org.orgId],
    ),
    client.query<SessionRow>(
      `SELECT id, season_year AS "seasonYear", category, question, answer_text AS "answerText",
              verdict, confidence, backed_claims AS "backedClaims", flagged_claims AS "flaggedClaims",
              matched_evidence_ids AS "matchedEvidenceIds", feedback, created_at AS "createdAt"
       FROM judge_sim_sessions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM judge_sim_sessions WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
    loadMediaEvidenceReferences(client, { orgId: org.orgId }),
  ]);

  const evidence = evidenceResult.rows.map(mapEvidence);
  const sessions = sessionResult.rows.map(mapSession);
  const readiness = computeReadiness(sessions, evidence.length);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    evidence,
    evidenceLibrary,
    sessions,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logEvidence(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    claim: string;
    category: JudgeSimCategory;
    sourceUrl: string | null;
    occurredOn: string | null;
    tags: string[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO judge_sim_evidence (org_id, title, claim, category, source_url, occurred_on, tags, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::date,$7::text[],$8)`,
    [input.orgId, input.title, input.claim, input.category, input.sourceUrl, input.occurredOn, input.tags, input.userId],
  );
}

export async function deleteEvidence(
  client: PoolClient,
  input: { orgId: string; evidenceId: string },
): Promise<void> {
  await client.query(`DELETE FROM judge_sim_evidence WHERE id = $1 AND org_id = $2`, [
    input.evidenceId,
    input.orgId,
  ]);
}

/** Runs one graded judge Q&A turn: picks (or accepts) a question, grades the answer against logged evidence. */
export async function runSession(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    category: JudgeSimCategory;
    question: string | null;
    answerText: string;
  },
): Promise<void> {
  const [evidenceResult, countResult] = await Promise.all([
    client.query<EvidenceRow>(
      `SELECT id, title, claim, category, source_url AS "sourceUrl", occurred_on::text AS "occurredOn",
              tags, created_at AS "createdAt"
       FROM judge_sim_evidence
       WHERE org_id = $1`,
      [input.orgId],
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM judge_sim_sessions WHERE org_id = $1 AND category = $2`,
      [input.orgId, input.category],
    ),
  ]);
  const evidence = evidenceResult.rows.map(mapEvidence);
  const question = input.question?.trim() || pickJudgeQuestion(input.category, Number(countResult.rows[0]?.count ?? 0));

  const grade = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "judge_sim",
    requestId: `judge-sim-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      category: input.category,
      seasonYear: input.seasonYear,
      note: "Deterministic claim-vs-logged-evidence token-overlap grading — no external model call",
    },
    invoke: async () => ({
      value: gradeAnswer(input.answerText, evidence),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-judge-sim-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO judge_sim_sessions (
       org_id, season_year, category, question, answer_text, verdict, confidence,
       backed_claims, flagged_claims, matched_evidence_ids, feedback, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[],$9::text[],$10::uuid[],$11,$12)`,
    [
      input.orgId,
      input.seasonYear,
      input.category,
      question,
      input.answerText,
      grade.verdict,
      grade.confidence,
      grade.backedClaims,
      grade.flaggedClaims,
      grade.matchedEvidenceIds,
      grade.feedback,
      input.userId,
    ],
  );
}

export async function deleteSession(
  client: PoolClient,
  input: { orgId: string; sessionId: string },
): Promise<void> {
  await client.query(`DELETE FROM judge_sim_sessions WHERE id = $1 AND org_id = $2`, [
    input.sessionId,
    input.orgId,
  ]);
}
