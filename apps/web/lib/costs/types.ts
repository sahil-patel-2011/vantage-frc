// Season Costs & Budget domain types. Pure data shapes — no I/O, no framework imports.
// This tracks a team's TOTAL cost of a season: real-world spend (FRC registration + event
// fees + everything bought), recurring subscriptions, AND the app's own AI/API usage — so the
// team sees the complete picture and can keep it under budget.

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

export type SubscriptionCadence = "monthly" | "annual" | "one_time";

export type SeasonSubscription = {
  id: string;
  name: string;
  provider: string | null;
  amountUsd: number;
  cadence: SubscriptionCadence;
  active: boolean;
  notes: string | null;
};

export type SubscriptionWithAnnual = SeasonSubscription & { annualUsd: number };

export type SubscriptionsSummary = {
  count: number;
  activeCount: number;
  /** Annualized total of ACTIVE subscriptions (monthly ×12, annual ×1, one-time ×1). */
  totalAnnual: number;
  items: SubscriptionWithAnnual[];
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

export type AllCostsSource = "season" | "subscriptions" | "api";

export type AllCostsSummary = {
  /** Real-world season purchases + fees (committed). */
  seasonCommitted: number;
  /** Annualized recurring subscriptions. */
  subscriptionsAnnual: number;
  /** The app's own AI/API usage cost for the season (from the usage ledger). */
  apiUsageUsd: number;
  /** Everything, added up. */
  grandTotal: number;
  breakdown: Array<{ key: AllCostsSource; label: string; amount: number; pct: number }>;
};

export type BudgetStatus = "unset" | "healthy" | "watch" | "over";

export type BudgetInsight = {
  status: BudgetStatus;
  headline: string;
  recommendations: string[];
};
