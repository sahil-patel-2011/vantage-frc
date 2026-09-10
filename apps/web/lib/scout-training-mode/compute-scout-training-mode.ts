import type { PoolClient } from "@neondatabase/serverless";
import { computeAccuracy, summarizeAttempts } from ".";
import type { PracticeMatch, TrainingAttempt, TrainingSummary, TrainingWinner } from "./types";

const PRACTICE_MATCH_LIMIT = 12;
const TRAINING_WINNERS: TrainingWinner[] = ["red", "blue", "tie"];

export type TrainingSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type ScoutTrainingView =
  | {
      status: "setup_required";
      message: string;
      steps: TrainingSetupStep[];
      orgId: string | null;
    }
  | {
      status: "live";
      orgId: string;
      teamNumber: number | null;
      practiceMatches: PracticeMatch[];
      attempts: TrainingAttempt[];
      summary: TrainingSummary;
      computedAt: string;
    };

function normalizeWinner(value: string | null): TrainingWinner | null {
  return value != null && (TRAINING_WINNERS as string[]).includes(value) ? (value as TrainingWinner) : null;
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

type PracticeMatchRow = {
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  winningAlliance: string | null;
  redScore: number | null;
  blueScore: number | null;
};

function mapPracticeMatch(row: PracticeMatchRow): PracticeMatch {
  return {
    matchKey: row.matchKey,
    eventKey: row.eventKey,
    compLevel: row.compLevel,
    matchNumber: row.matchNumber,
    winningAlliance: normalizeWinner(row.winningAlliance),
    redScore: row.redScore == null ? null : Number(row.redScore),
    blueScore: row.blueScore == null ? null : Number(row.blueScore),
  };
}

async function fetchPracticeMatches(client: PoolClient): Promise<PracticeMatch[]> {
  const result = await client.query<PracticeMatchRow>(
    `SELECT match_key AS "matchKey", event_key AS "eventKey", comp_level AS "compLevel",
            match_number AS "matchNumber", winning_alliance AS "winningAlliance",
            NULLIF(score_breakdown -> 'red' ->> 'totalPoints', '')::int AS "redScore",
            NULLIF(score_breakdown -> 'blue' ->> 'totalPoints', '')::int AS "blueScore"
     FROM matches_ref
     WHERE score_breakdown IS NOT NULL
       AND winning_alliance IS NOT NULL
       AND winning_alliance <> ''
     ORDER BY random()
     LIMIT $1`,
    [PRACTICE_MATCH_LIMIT],
  );
  return result.rows.map(mapPracticeMatch);
}

type AttemptRow = {
  id: string;
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  predictedWinner: string;
  predictedRedScore: number;
  predictedBlueScore: number;
  actualWinningAlliance: string | null;
  actualRedScore: number | null;
  actualBlueScore: number | null;
  notes: string | null;
  durationSeconds: number;
  accuracyScore: number;
  submittedAt: string;
};

function mapAttempt(row: AttemptRow): TrainingAttempt {
  return {
    id: row.id,
    matchKey: row.matchKey,
    eventKey: row.eventKey,
    compLevel: row.compLevel,
    matchNumber: row.matchNumber,
    predictedWinner: normalizeWinner(row.predictedWinner) ?? "tie",
    predictedRedScore: Number(row.predictedRedScore) || 0,
    predictedBlueScore: Number(row.predictedBlueScore) || 0,
    actualWinningAlliance: normalizeWinner(row.actualWinningAlliance),
    actualRedScore: row.actualRedScore == null ? null : Number(row.actualRedScore),
    actualBlueScore: row.actualBlueScore == null ? null : Number(row.actualBlueScore),
    notes: row.notes,
    durationSeconds: Number(row.durationSeconds) || 0,
    accuracyScore: Number(row.accuracyScore) || 0,
    submittedAt: row.submittedAt,
  };
}

async function fetchAttempts(client: PoolClient, orgId: string): Promise<TrainingAttempt[]> {
  const result = await client.query<AttemptRow>(
    `SELECT a.id, a.match_key AS "matchKey", m.event_key AS "eventKey", m.comp_level AS "compLevel",
            m.match_number AS "matchNumber", a.predicted_winner AS "predictedWinner",
            a.predicted_red_score AS "predictedRedScore", a.predicted_blue_score AS "predictedBlueScore",
            m.winning_alliance AS "actualWinningAlliance",
            NULLIF(m.score_breakdown -> 'red' ->> 'totalPoints', '')::int AS "actualRedScore",
            NULLIF(m.score_breakdown -> 'blue' ->> 'totalPoints', '')::int AS "actualBlueScore",
            a.notes, a.duration_seconds AS "durationSeconds", a.accuracy_score AS "accuracyScore",
            a.submitted_at::text AS "submittedAt"
     FROM scout_training_attempts a
     JOIN matches_ref m ON m.match_key = a.match_key
     WHERE a.org_id = $1
     ORDER BY a.submitted_at DESC
     LIMIT 100`,
    [orgId],
  );
  return result.rows.map(mapAttempt);
}

export async function computeScoutTrainingView(
  client: PoolClient,
  input: { userId: string; requestedOrg: string | null },
): Promise<ScoutTrainingView> {
  const org = await resolveOrg(client, input.userId, input.requestedOrg);

  if (!org) {
    return {
      status: "setup_required",
      message: "Select a team to start scout training mode.",
      steps: [
        { id: "workspace", label: "Choose your team", detail: "Pick which FRC team you are working as.", href: "/workspace" },
      ],
      orgId: null,
    };
  }

  const [practiceMatches, attempts] = await Promise.all([fetchPracticeMatches(client), fetchAttempts(client, org.orgId)]);

  if (practiceMatches.length === 0 && attempts.length === 0) {
    return {
      status: "setup_required",
      message: "No historical match data is synced yet, so there is nothing to practice-scout against.",
      steps: [
        {
          id: "reference-sync",
          label: "Sync competition data",
          detail: "Historical matches populate once your team's events sync from The Blue Alliance.",
          href: "/competition",
        },
      ],
      orgId: org.orgId,
    };
  }

  const summary = summarizeAttempts(attempts);

  return {
    status: "live",
    orgId: org.orgId,
    teamNumber: org.teamNumber,
    practiceMatches,
    attempts,
    summary,
    computedAt: new Date().toISOString(),
  };
}

// ---- write helpers (run inside the caller's withRls transaction) ----

export async function submitAttempt(
  client: PoolClient,
  input: {
    orgId: string;
    userId: string;
    matchKey: string;
    predictedWinner: TrainingWinner;
    predictedRedScore: number;
    predictedBlueScore: number;
    durationSeconds: number;
    notes: string | null;
  },
): Promise<void> {
  const matchResult = await client.query<{
    winningAlliance: string | null;
    redScore: number | null;
    blueScore: number | null;
  }>(
    `SELECT winning_alliance AS "winningAlliance",
            NULLIF(score_breakdown -> 'red' ->> 'totalPoints', '')::int AS "redScore",
            NULLIF(score_breakdown -> 'blue' ->> 'totalPoints', '')::int AS "blueScore"
     FROM matches_ref WHERE match_key = $1`,
    [input.matchKey],
  );
  const match = matchResult.rows[0];
  if (!match) throw new Error("Unknown historical match");

  const accuracyScore = computeAccuracy({
    predictedWinner: input.predictedWinner,
    actualWinningAlliance: normalizeWinner(match.winningAlliance),
    predictedRedScore: input.predictedRedScore,
    predictedBlueScore: input.predictedBlueScore,
    actualRedScore: match.redScore == null ? null : Number(match.redScore),
    actualBlueScore: match.blueScore == null ? null : Number(match.blueScore),
  });

  await client.query(
    `INSERT INTO scout_training_attempts (
       org_id, match_key, trainee_user_id, predicted_winner, predicted_red_score,
       predicted_blue_score, notes, duration_seconds, accuracy_score
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.orgId,
      input.matchKey,
      input.userId,
      input.predictedWinner,
      Math.max(0, Math.round(input.predictedRedScore)),
      Math.max(0, Math.round(input.predictedBlueScore)),
      input.notes,
      Math.max(0, Math.round(input.durationSeconds)),
      accuracyScore,
    ],
  );
}

export async function deleteAttempt(client: PoolClient, input: { orgId: string; attemptId: string }): Promise<void> {
  await client.query(`DELETE FROM scout_training_attempts WHERE id = $1 AND org_id = $2`, [
    input.attemptId,
    input.orgId,
  ]);
}
