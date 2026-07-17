// Season Costs & Budget domain types. Pure data shapes — no I/O, no framework imports.
// This tracks a team's REAL-WORLD season spend (FRC registration + event fees + everything
// bought), not the app's own AI/usage costs. Goal: keep the team under budget, with an
// opt-in automated finance assistant that turns the numbers into guidance.

export type CostCategory =
  | "registration"
  | "event_fee"
  | "parts"
  | "materials"
  | "tools"
  | "travel"
  | "marketing"
  | "safety"
  | "field"
  | "other";

export type CostStatus = "planned" | "paid";

export type SeasonCost = {
  id: string;
  label: string;
  category: CostCategory;
  amountUsd: number;
  vendor: string | null;
  /** ISO date (YYYY-MM-DD). */
  incurredOn: string;
  status: CostStatus;
  notes: string | null;
};

export type SeasonBudget = {
  seasonYear: number;
  /** Total budget for the season, or null if not yet set. */
  totalBudgetUsd: number | null;
  /** Opt-in: allow the automated finance assistant to analyze the budget. */
  aiAssistEnabled: boolean;
  notes: string | null;
};

export type CategoryBreakdown = {
  category: CostCategory;
  committed: number;
  paid: number;
  planned: number;
  count: number;
};

export type CostSummary = {
  count: number;
  /** paid + planned (everything counted against the budget). */
  totalCommitted: number;
  totalPaid: number;
  totalPlanned: number;
  /** registration + event_fee committed — the big fixed season fees. */
  feesTotal: number;
  byCategory: CategoryBreakdown[];
  byMonth: Array<{ month: string; committed: number }>;
  largestCategory: { category: CostCategory; committed: number } | null;
  /** budget - committed, or null when no budget is set. */
  remaining: number | null;
  /** committed / budget (0..∞), or null when no budget is set. */
  pctUsed: number | null;
  overBudget: boolean;
};

export type BudgetStatus = "unset" | "healthy" | "watch" | "over";

export type BudgetInsight = {
  status: BudgetStatus;
  headline: string;
  recommendations: string[];
};
