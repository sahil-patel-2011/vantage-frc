// Risk Register domain types. Pure data shapes — no I/O, no framework imports.
// An FMEA-lite register for the season: identify what could go wrong (mechanism failure,
// schedule slip, funding gap, driver availability…), score likelihood × impact, assign a
// mitigation + owner, and track it to closure. The app derives severity, a 5×5 matrix, and
// a prioritized risk profile.

export type RiskCategory = "technical" | "schedule" | "funding" | "logistics" | "safety" | "people" | "other";

export type RiskStatus = "open" | "mitigating" | "monitoring" | "accepted" | "closed";

export type RiskLevel = "low" | "moderate" | "high" | "critical";

export type TeamRisk = {
  id: string;
  title: string;
  category: RiskCategory;
  /** 1 (rare) … 5 (almost certain). */
  likelihood: number;
  /** 1 (negligible) … 5 (severe). */
  impact: number;
  status: RiskStatus;
  mitigation: string | null;
  owner: string | null;
  /** ISO date (YYYY-MM-DD) the mitigation is due, or null. */
  dueOn: string | null;
  notes: string | null;
  seasonYear: number;
};

export type RiskEvaluation = {
  risk: TeamRisk;
  /** likelihood × impact, 1..25. */
  score: number;
  level: RiskLevel;
  /** Still live (not closed). Accepted risks remain live but acknowledged. */
  active: boolean;
  /** Mitigation past due and still actionable. */
  overdue: boolean;
  daysToDue: number | null;
};

export type MatrixCell = {
  likelihood: number;
  impact: number;
  score: number;
  level: RiskLevel;
  count: number;
};

export type RiskSummary = {
  total: number;
  active: number;
  byLevel: Record<RiskLevel, number>;
  byStatus: Record<RiskStatus, number>;
  byCategory: Array<{ category: RiskCategory; active: number; avgScore: number }>;
  /** Active risks, highest score first. */
  topRisks: RiskEvaluation[];
  /** Active risks whose mitigation is overdue, highest score first. */
  overdue: RiskEvaluation[];
  highestScore: number;
  avgScore: number;
};
