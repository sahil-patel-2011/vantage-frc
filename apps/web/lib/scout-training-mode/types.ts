// Scout Training Mode domain types. Pure data shapes — no I/O, no framework imports.
// New scouts practice scouting on real, already-completed historical matches (matches_ref) and
// get an accuracy score comparing their prediction to what actually happened.

export type TrainingWinner = "red" | "blue" | "tie";

/** A completed historical match available to practice-scout against. */
export type PracticeMatch = {
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  winningAlliance: TrainingWinner | null;
  redScore: number | null;
  blueScore: number | null;
};

export type TrainingAttempt = {
  id: string;
  matchKey: string;
  eventKey: string;
  compLevel: string;
  matchNumber: number;
  predictedWinner: TrainingWinner;
  predictedRedScore: number;
  predictedBlueScore: number;
  actualWinningAlliance: TrainingWinner | null;
  actualRedScore: number | null;
  actualBlueScore: number | null;
  notes: string | null;
  durationSeconds: number;
  accuracyScore: number;
  submittedAt: string;
};

export type TrainingSummary = {
  totalAttempts: number;
  averageAccuracy: number;
  bestAccuracy: number;
  winnerCallAccuracy: number;
  /** Chronological (oldest first) accuracy scores of the most recent attempts, for a trend view. */
  recentAccuracyTrend: number[];
};
