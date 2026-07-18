// Field-count budget linter domain types. Pure data shapes — no I/O, no framework imports.
// A "snapshot" is a point-in-time record of how many fields a scouting schema asks a scout to
// fill per match phase; the linter checks those counts against a realistic per-match budget so
// teams catch over-ambitious schemas before they hit the field.

export type FieldBudgetPhase = "auto" | "teleop" | "endgame" | "pit" | "post_match";

export type FieldBudgetSnapshot = {
  id: string;
  schemaName: string;
  autoFields: number;
  teleopFields: number;
  endgameFields: number;
  pitFields: number;
  postMatchFields: number;
  totalFields: number;
  /** Live-match fields only (auto + teleop + endgame) — the fields a scout must record in real time. */
  liveFields: number;
  notes: string | null;
  createdAt: string;
};

export type FieldBudgetSeverity = "ok" | "warning" | "critical";

export type FieldBudgetPhaseResult = {
  phase: FieldBudgetPhase;
  count: number;
  budget: number;
  overBudget: boolean;
  overBy: number;
};

export type FieldBudgetLintResult = {
  snapshotId: string;
  schemaName: string;
  totalFields: number;
  liveFields: number;
  liveBudget: number;
  severity: FieldBudgetSeverity;
  overBudget: boolean;
  phases: FieldBudgetPhaseResult[];
  recommendations: string[];
};

export type FieldBudgetSummary = {
  totalSnapshots: number;
  latest: FieldBudgetLintResult | null;
  overBudgetCount: number;
  okCount: number;
  averageLiveFields: number;
  worstPhase: FieldBudgetPhase | null;
};
