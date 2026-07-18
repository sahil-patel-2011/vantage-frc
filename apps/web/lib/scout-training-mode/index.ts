// Scout Training Mode pure helpers. Deterministic given their inputs — no I/O, no framework imports.

import type { TrainingAttempt, TrainingSummary, TrainingWinner } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * 0..1 closeness between a predicted score and the actual score, relative to the actual
 * magnitude (so a 10-point miss on a 40-point match reads worse than the same miss on 150).
 */
function scoreCloseness(predicted: number, actual: number): number {
  const denom = Math.max(actual, 20);
  const error = Math.abs(predicted - actual) / denom;
  return clamp01(1 - error);
}

/**
 * Blend a correct winner call (50% weight) with how close the predicted final scores were
 * to the actual final scores (50% weight). Missing actual scores fall back to winner-only.
 */
export function computeAccuracy(input: {
  predictedWinner: TrainingWinner;
  actualWinningAlliance: TrainingWinner | null;
  predictedRedScore: number;
  predictedBlueScore: number;
  actualRedScore: number | null;
  actualBlueScore: number | null;
}): number {
  const winnerCorrect = input.actualWinningAlliance != null && input.predictedWinner === input.actualWinningAlliance ? 1 : 0;

  if (input.actualRedScore == null || input.actualBlueScore == null) {
    return round2(winnerCorrect);
  }

  const redCloseness = scoreCloseness(input.predictedRedScore, input.actualRedScore);
  const blueCloseness = scoreCloseness(input.predictedBlueScore, input.actualBlueScore);
  const closeness = (redCloseness + blueCloseness) / 2;

  return round2(clamp01(0.5 * winnerCorrect + 0.5 * closeness));
}

export function summarizeAttempts(attempts: TrainingAttempt[]): TrainingSummary {
  if (attempts.length === 0) {
    return {
      totalAttempts: 0,
      averageAccuracy: 0,
      bestAccuracy: 0,
      winnerCallAccuracy: 0,
      recentAccuracyTrend: [],
    };
  }

  const totalAccuracy = attempts.reduce((sum, attempt) => sum + attempt.accuracyScore, 0);
  const bestAccuracy = attempts.reduce((max, attempt) => Math.max(max, attempt.accuracyScore), 0);
  const winnerCalls = attempts.filter(
    (attempt) => attempt.actualWinningAlliance != null && attempt.predictedWinner === attempt.actualWinningAlliance,
  ).length;

  const chronological = [...attempts].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const recentAccuracyTrend = chronological.slice(-10).map((attempt) => attempt.accuracyScore);

  return {
    totalAttempts: attempts.length,
    averageAccuracy: round2(totalAccuracy / attempts.length),
    bestAccuracy: round2(bestAccuracy),
    winnerCallAccuracy: round2(winnerCalls / attempts.length),
    recentAccuracyTrend,
  };
}

export function trainingWinnerLabel(winner: TrainingWinner | null): string {
  if (winner === "red") return "Red alliance";
  if (winner === "blue") return "Blue alliance";
  if (winner === "tie") return "Tie";
  return "Unknown";
}
