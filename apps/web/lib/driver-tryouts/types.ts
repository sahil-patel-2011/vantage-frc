// Driver tryouts domain types. Pure data shapes — no I/O, no framework imports.
// Candidates try out for a drive-team seat (driver / operator / human player); evaluators
// score each candidate against a fixed rubric so selection is backed by a record, not a vibe.

export type DriverTryoutsRole = "driver" | "operator" | "human_player" | "any";

export type DriverTryoutsStatus = "active" | "selected" | "cut" | "withdrawn";

export type DriverTryoutsCandidate = {
  id: string;
  name: string;
  gradeLevel: string | null;
  roleInterest: DriverTryoutsRole;
  status: DriverTryoutsStatus;
  notes: string | null;
  seasonYear: number;
};

/** 1..5 rubric scores captured per evaluator, per candidate, per session. */
export type DriverTryoutsEvaluation = {
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

export type DriverTryoutsCriterion =
  | "precision"
  | "awareness"
  | "communication"
  | "composure"
  | "mechanical";

export type DriverTryoutsCandidateScore = {
  candidateId: string;
  candidate: DriverTryoutsCandidate;
  evaluationCount: number;
  averages: Record<DriverTryoutsCriterion, number>;
  overallAverage: number;
  rank: number | null;
};

export type DriverTryoutsSummary = {
  totalCandidates: number;
  totalEvaluations: number;
  evaluatedCandidates: number;
  candidateScores: DriverTryoutsCandidateScore[];
};

export type DriverTryoutsReadinessTier = "not_started" | "in_progress" | "ready";

export type DriverTryoutsReadiness = {
  /** 0..1 overall selection-readiness signal. */
  score: number;
  tier: DriverTryoutsReadinessTier;
  candidatesFullyEvaluated: number;
  recommendations: string[];
};
