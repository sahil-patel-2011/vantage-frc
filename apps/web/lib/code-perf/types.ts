// Code-vs-match regression detective domain types. Pure data shapes — no I/O, no framework imports.
// Correlates logged code/software-version/tuning changes against match-by-match auto/teleop
// performance to flag whether a change actually moved the needle on-field.

export type ChangeType = "commit" | "software_version" | "tuning";

export type Subsystem =
  | "drivetrain"
  | "intake"
  | "shooter"
  | "climber"
  | "vision"
  | "autonomous"
  | "general"
  | "other";

export type CorrelationVerdict = "improved" | "regressed" | "neutral" | "insufficient_data";

export type CodePerfChange = {
  id: string;
  seasonYear: number;
  occurredOn: string;
  changeType: ChangeType;
  subsystem: Subsystem;
  title: string;
  commitSha: string | null;
  repoUrl: string | null;
  description: string | null;
  verdict: CorrelationVerdict;
  deltaAuto: number | null;
  deltaTeleop: number | null;
  deltaTotal: number | null;
  matchesBefore: number;
  matchesAfter: number;
  rationale: string | null;
  analyzedAt: string | null;
  createdAt: string;
};

export type CodePerfMatchResult = {
  id: string;
  seasonYear: number;
  occurredOn: string;
  matchKey: string;
  eventKey: string | null;
  autoPoints: number;
  teleopPoints: number;
  endgamePoints: number;
  totalPoints: number;
  notes: string | null;
  createdAt: string;
};

/** Deterministic before/after correlation computed from logged match results around a change. */
export type ChangeCorrelation = {
  verdict: CorrelationVerdict;
  deltaAuto: number | null;
  deltaTeleop: number | null;
  deltaTotal: number | null;
  matchesBefore: number;
  matchesAfter: number;
  avgAutoBefore: number | null;
  avgTeleopBefore: number | null;
  avgAutoAfter: number | null;
  avgTeleopAfter: number | null;
  rationale: string;
};

export type CodePerfSummary = {
  totalChanges: number;
  analyzedChanges: number;
  improved: number;
  regressed: number;
  neutral: number;
  insufficientData: number;
  totalMatches: number;
  bySubsystem: Array<{
    subsystem: Subsystem;
    changes: number;
    improved: number;
    regressed: number;
  }>;
};
