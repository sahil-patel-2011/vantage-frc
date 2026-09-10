import { randomUUID } from "node:crypto";
import type { PoolClient } from "@neondatabase/serverless";
import { meteredAI } from "@vantage/billing";
import { MOCK_JUDGING_AWARD_CATEGORIES, pickMockJudgingQuestion, scoreAnswer } from ".";
import type {
  MockJudgingAwardCategory,
  MockJudgingCriteriaScores,
  MockJudgingPrepNote,
  MockJudgingReadiness,
  MockJudgingSession,
} from "./types";

export { MOCK_JUDGING_AWARD_CATEGORIES };

export type MockJudgingSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type MockJudgingView =
  | {
      status: "setup_required";
      message: string;
      steps: MockJudgingSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      notes: MockJudgingPrepNote[];
      sessions: MockJudgingSession[];
      readiness: MockJudgingReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

function isAwardCategory(value: unknown): value is MockJudgingAwardCategory {
  return typeof value === "string" && (MOCK_JUDGING_AWARD_CATEGORIES as string[]).includes(value);
}

type NoteRow = {
  id: string;
  title: string;
  note: string;
  awardCategory: string;
  tags: string[] | null;
  createdAt: string;
};

function mapNote(row: NoteRow): MockJudgingPrepNote {
  return {
    id: row.id,
    title: row.title,
    note: row.note,
    awardCategory: isAwardCategory(row.awardCategory) ? row.awardCategory : "general",
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.createdAt,
  };
}

type SessionRow = {
  id: string;
  seasonYear: number;
  awardCategory: string;
  question: string;
  answerText: string;
  criteriaScores: MockJudgingCriteriaScores | null;
  overallScore: string;
  strengths: string[] | null;
  improvements: string[] | null;
  feedback: string;
  createdAt: string;
};

function mapSession(row: SessionRow): MockJudgingSession {
  return {
    id: row.id,
    seasonYear: row.seasonYear,
    awardCategory: isAwardCategory(row.awardCategory) ? row.awardCategory : "general",
    question: row.question,
    answerText: row.answerText,
    criteriaScores:
      row.criteriaScores ?? {
        substance: 0,
        specificity: 0,
        evidence_grounding: 0,
        clarity: 0,
        confidence: 0,
      },
    overallScore: Number(row.overallScore) || 0,
    strengths: Array.isArray(row.strengths) ? row.strengths : [],
    improvements: Array.isArray(row.improvements) ? row.improvements : [],
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

function computeReadiness(
  sessions: MockJudgingSession[],
  notesCount: number,
): MockJudgingReadiness {
  const totalSessions = sessions.length;
  const strongSessionCount = sessions.filter((s) => s.overallScore >= 4).length;
  const weakSessionCount = sessions.filter((s) => s.overallScore < 2.8).length;
  const categoriesCovered = new Set(sessions.map((s) => s.awardCategory)).size;
  const meanScore =
    totalSessions > 0 ? sessions.reduce((sum, s) => sum + s.overallScore, 0) / totalSessions : 0;
  const score = totalSessions > 0 ? Math.round((meanScore / 5) * 1000) / 1000 : 0;
  return { score, totalSessions, strongSessionCount, weakSessionCount, categoriesCovered, notesCount };
}

export async function computeMockJudgingView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<MockJudgingView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to run mock judging practice sessions.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [noteResult, sessionResult, seasonResult] = await Promise.all([
    client.query<NoteRow>(
      `SELECT id, title, note, award_category AS "awardCategory", tags, created_at AS "createdAt"
       FROM mock_judging_prep_notes
       WHERE org_id = $1
       ORDER BY created_at DESC`,
      [org.orgId],
    ),
    client.query<SessionRow>(
      `SELECT id, season_year AS "seasonYear", award_category AS "awardCategory", question,
              answer_text AS "answerText", criteria_scores AS "criteriaScores",
              overall_score AS "overallScore", strengths, improvements, feedback,
              created_at AS "createdAt"
       FROM mock_judging_sessions
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at DESC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM mock_judging_sessions WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const notes = noteResult.rows.map(mapNote);
  const sessions = sessionResult.rows.map(mapSession);
  const readiness = computeReadiness(sessions, notes.length);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    notes,
    sessions,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function logPrepNote(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    title: string;
    note: string;
    awardCategory: MockJudgingAwardCategory;
    tags: string[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO mock_judging_prep_notes (org_id, title, note, award_category, tags, created_by)
     VALUES ($1,$2,$3,$4,$5::text[],$6)`,
    [input.orgId, input.title, input.note, input.awardCategory, input.tags, input.userId],
  );
}

export async function deletePrepNote(
  client: PoolClient,
  input: { orgId: string; noteId: string },
): Promise<void> {
  await client.query(`DELETE FROM mock_judging_prep_notes WHERE id = $1 AND org_id = $2`, [
    input.noteId,
    input.orgId,
  ]);
}

/** Runs one rubric-scored mock judging round: picks (or accepts) a question, scores the answer. */
export async function runSession(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    seasonYear: number;
    awardCategory: MockJudgingAwardCategory;
    question: string | null;
    answerText: string;
  },
): Promise<void> {
  const [noteResult, countResult] = await Promise.all([
    client.query<NoteRow>(
      `SELECT id, title, note, award_category AS "awardCategory", tags, created_at AS "createdAt"
       FROM mock_judging_prep_notes
       WHERE org_id = $1`,
      [input.orgId],
    ),
    client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM mock_judging_sessions WHERE org_id = $1 AND award_category = $2`,
      [input.orgId, input.awardCategory],
    ),
  ]);
  const notes = noteResult.rows.map(mapNote);
  const question =
    input.question?.trim() || pickMockJudgingQuestion(input.awardCategory, Number(countResult.rows[0]?.count ?? 0));

  const grade = await meteredAI({
    client,
    orgId: input.orgId,
    userId: input.userId,
    feature: "mock_judging",
    requestId: `mock-judging-${randomUUID()}`,
    estimatedCostUsd: 0,
    keySource: "local_cli",
    metadata: {
      awardCategory: input.awardCategory,
      seasonYear: input.seasonYear,
      note: "Deterministic rubric scoring against the answer text and logged prep notes — no external model call",
    },
    invoke: async () => ({
      value: scoreAnswer(input.answerText, notes),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "vantage-mock-judging-v1",
      provider: "vantage-local",
    }),
  });

  await client.query(
    `INSERT INTO mock_judging_sessions (
       org_id, season_year, award_category, question, answer_text, criteria_scores,
       overall_score, strengths, improvements, feedback, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::text[],$9::text[],$10,$11)`,
    [
      input.orgId,
      input.seasonYear,
      input.awardCategory,
      question,
      input.answerText,
      JSON.stringify(grade.criteriaScores),
      grade.overallScore,
      grade.strengths,
      grade.improvements,
      grade.feedback,
      input.userId,
    ],
  );
}

export async function deleteSession(
  client: PoolClient,
  input: { orgId: string; sessionId: string },
): Promise<void> {
  await client.query(`DELETE FROM mock_judging_sessions WHERE id = $1 AND org_id = $2`, [
    input.sessionId,
    input.orgId,
  ]);
}
