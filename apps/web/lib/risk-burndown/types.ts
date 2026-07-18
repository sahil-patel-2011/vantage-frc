// Season risk-register burndown domain types. Pure data shapes — no I/O, no framework imports.
// Tracks season risks (technical, schedule, budget, personnel, logistics, safety) with
// likelihood/impact scoring and mitigation plans so the team can watch open risk burn down.

export type RiskCategory =
  | "technical"
  | "schedule"
  | "budget"
  | "personnel"
  | "logistics"
  | "safety"
  | "other";

export type RiskStatus = "open" | "mitigating" | "closed" | "accepted";

export type RiskSeverityBand = "low" | "medium" | "high" | "critical";

export type RiskItem = {
  id: string;
  title: string;
  description: string | null;
  category: RiskCategory;
  status: RiskStatus;
  /** 1 (rare) .. 5 (near certain). */
  likelihood: number;
  /** 1 (minor) .. 5 (severe). */
  impact: number;
  /** likelihood * impact, 1..25. */
  severity: number;
  severityBand: RiskSeverityBand;
  ownerName: string | null;
  mitigationPlan: string | null;
  identifiedOn: string;
  targetCloseDate: string | null;
  closedOn: string | null;
  seasonYear: number;
  createdAt: string;
};

export type RiskBurndownPoint = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Count of risks open (not closed/accepted) as of this date. */
  openCount: number;
};

export type RiskSummary = {
  totalRisks: number;
  openRisks: number;
  mitigatingRisks: number;
  closedRisks: number;
  acceptedRisks: number;
  avgSeverity: number;
  highSeverityOpenCount: number;
  byCategory: Array<{ category: RiskCategory; count: number; avgSeverity: number }>;
  byStatus: Array<{ status: RiskStatus; count: number }>;
  bySeverityBand: Array<{ band: RiskSeverityBand; count: number }>;
  /** 0..1 signal blending mitigation progress with absence of unmitigated critical risk. */
  burndownSignal: number;
};
