import type { PoolClient } from "@neondatabase/serverless";
import { computeDriverTryoutsReadiness, parseLoggedRubricScores, summarizeDriverTryouts } from ".";
import type {
  DriverTryoutsCandidate,
  DriverTryoutsEvaluation,
  DriverTryoutsReadiness,
  DriverTryoutsRole,
  DriverTryoutsStatus,
  DriverTryoutsSummary,
} from "./types";

export type DriverTryoutsSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type DriverTryoutsView =
  | {
      status: "setup_required";
      message: string;
      steps: DriverTryoutsSetupStep[];
      orgId: string | null;
      seasonYear: number;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      seasonYear: number;
      seasons: number[];
      candidates: DriverTryoutsCandidate[];
      evaluations: DriverTryoutsEvaluation[];
      summary: DriverTryoutsSummary;
      readiness: DriverTryoutsReadiness;
      computedAt: string;
    };

export function currentSeasonYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

type CandidateRow = {
  id: string;
  name: string;
  gradeLevel: string | null;
  roleInterest: DriverTryoutsRole;
  status: DriverTryoutsStatus;
  notes: string | null;
  seasonYear: number;
};

type EvaluationRow = {
  id: string;
  candidateId: string;
  evaluatorId: string;
  evaluatedOn: string;
  scorePrecision: number;
  scoreAwareness: number;
  scoreCommunication: number;
  scoreComposure: number;
  scoreMechanical: number;
  notes: string | null;
};

function mapCandidate(row: CandidateRow): DriverTryoutsCandidate {
  return {
    id: row.id,
    name: row.name,
    gradeLevel: row.gradeLevel,
    roleInterest: row.roleInterest,
    status: row.status,
    notes: row.notes,
    seasonYear: row.seasonYear,
  };
}

function mapEvaluation(row: EvaluationRow): DriverTryoutsEvaluation | null {
  const scores = parseLoggedRubricScores({
    scorePrecision: row.scorePrecision,
    scoreAwareness: row.scoreAwareness,
    scoreCommunication: row.scoreCommunication,
    scoreComposure: row.scoreComposure,
    scoreMechanical: row.scoreMechanical,
  });
  if (!scores) return null;
  return {
    id: row.id,
    candidateId: row.candidateId,
    evaluatorId: row.evaluatorId,
    evaluatedOn: row.evaluatedOn,
    scorePrecision: scores.precision,
    scoreAwareness: scores.awareness,
    scoreCommunication: scores.communication,
    scoreComposure: scores.composure,
    scoreMechanical: scores.mechanical,
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

export async function computeDriverTryoutsView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null; seasonYear?: number | null },
): Promise<DriverTryoutsView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);
  const seasonYear = input.seasonYear && input.seasonYear > 2000 ? input.seasonYear : currentSeasonYear();

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team workspace to run driver tryouts.",
      steps: [
        { id: "workspace", label: "Select workspace", detail: "Choose your team organization", href: "/workspace" },
      ],
      orgId: null,
      seasonYear,
    };
  }

  const [candidateResult, seasonResult] = await Promise.all([
    client.query<CandidateRow>(
      `SELECT id, name, grade_level AS "gradeLevel", role_interest AS "roleInterest", status,
              notes, season_year AS "seasonYear"
       FROM driver_tryouts_candidates
       WHERE org_id = $1 AND season_year = $2
       ORDER BY created_at ASC`,
      [org.orgId, seasonYear],
    ),
    client.query<{ seasonYear: number }>(
      `SELECT DISTINCT season_year AS "seasonYear" FROM driver_tryouts_candidates WHERE org_id = $1 ORDER BY season_year DESC`,
      [org.orgId],
    ),
  ]);

  const candidates = candidateResult.rows.map(mapCandidate);
  const candidateIds = candidates.map((c) => c.id);

  const evaluationResult = candidateIds.length
    ? await client.query<EvaluationRow>(
        `SELECT id, candidate_id AS "candidateId", evaluator_id AS "evaluatorId",
                evaluated_on::text AS "evaluatedOn", score_precision AS "scorePrecision",
                score_awareness AS "scoreAwareness", score_communication AS "scoreCommunication",
                score_composure AS "scoreComposure", score_mechanical AS "scoreMechanical", notes
         FROM driver_tryouts_evaluations
         WHERE org_id = $1 AND candidate_id = ANY($2::uuid[])
         ORDER BY evaluated_on DESC, created_at DESC`,
        [org.orgId, candidateIds],
      )
    : { rows: [] as EvaluationRow[] };

  const evaluations = evaluationResult.rows
    .map(mapEvaluation)
    .filter((evaluation): evaluation is DriverTryoutsEvaluation => evaluation != null);
  const summary = summarizeDriverTryouts(candidates, evaluations);
  const readiness = computeDriverTryoutsReadiness(summary);
  const seasons = seasonResult.rows.map((r) => r.seasonYear);
  if (!seasons.includes(seasonYear)) seasons.unshift(seasonYear);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    seasonYear,
    seasons,
    candidates,
    evaluations,
    summary,
    readiness,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function addCandidate(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    name: string;
    gradeLevel: string | null;
    roleInterest: DriverTryoutsRole;
    notes: string | null;
    seasonYear: number;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO driver_tryouts_candidates (
       org_id, name, grade_level, role_interest, notes, season_year, added_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [input.orgId, input.name, input.gradeLevel, input.roleInterest, input.notes, input.seasonYear, input.userId],
  );
}

export async function updateCandidateStatus(
  client: PoolClient,
  input: { orgId: string; candidateId: string; status: DriverTryoutsStatus },
): Promise<void> {
  await client.query(
    `UPDATE driver_tryouts_candidates SET status = $1 WHERE id = $2 AND org_id = $3`,
    [input.status, input.candidateId, input.orgId],
  );
}

export async function deleteCandidate(
  client: PoolClient,
  input: { orgId: string; candidateId: string },
): Promise<void> {
  await client.query(`DELETE FROM driver_tryouts_candidates WHERE id = $1 AND org_id = $2`, [
    input.candidateId,
    input.orgId,
  ]);
}

export async function addEvaluation(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    candidateId: string;
    evaluatedOn: string;
    scorePrecision: number;
    scoreAwareness: number;
    scoreCommunication: number;
    scoreComposure: number;
    scoreMechanical: number;
    notes: string | null;
  },
): Promise<void> {
  const scores = parseLoggedRubricScores(input);
  if (!scores) {
    throw new Error("each rubric score must be an integer from 1 to 5");
  }
  await client.query(
    `INSERT INTO driver_tryouts_evaluations (
       org_id, candidate_id, evaluator_id, evaluated_on, score_precision, score_awareness,
       score_communication, score_composure, score_mechanical, notes
     ) VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10)`,
    [
      input.orgId,
      input.candidateId,
      input.userId,
      input.evaluatedOn,
      scores.precision,
      scores.awareness,
      scores.communication,
      scores.composure,
      scores.mechanical,
      input.notes,
    ],
  );
}

export async function deleteEvaluation(
  client: PoolClient,
  input: { orgId: string; evaluationId: string },
): Promise<void> {
  await client.query(`DELETE FROM driver_tryouts_evaluations WHERE id = $1 AND org_id = $2`, [
    input.evaluationId,
    input.orgId,
  ]);
}
