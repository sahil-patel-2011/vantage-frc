// Budget-reconciler domain types. Pure data shapes — no I/O, no framework imports.
// Watches the existing weight/power budgets (weight_components + weight_settings, power_loads)
// for as-designed mass/current drift past target and proposes which subsystem to trim.

export type BudgetStatus = "over" | "under" | "on_target";

/** Per-subsystem as-designed mass + current draw, aggregated from weight_components / power_loads. */
export type SubsystemContribution = {
  subsystem: string;
  massLbs: number;
  currentAmps: number;
};

/** Deterministic mass-vs-limit reading. */
export type MassReading = {
  totalLbs: number;
  limitLbs: number;
  driftLbs: number;
  driftPct: number;
  status: BudgetStatus;
};

/** Deterministic current-draw-vs-breaker-budget reading. */
export type CurrentReading = {
  totalAmps: number;
  breakerAmps: number;
  driftAmps: number;
  driftPct: number;
  status: BudgetStatus;
};

/** Which subsystem to trim, and by how much, to close a mass-budget overage. */
export type TrimProposal = {
  subsystem: string;
  currentMassLbs: number;
  recommendedTrimLbs: number;
  rationale: string;
};

/** A saved reconciliation run, persisted to budget_reconciler_reports. */
export type BudgetReconcilerReport = {
  id: string;
  seasonYear: number;
  massTotalLbs: number;
  massLimitLbs: number;
  massDriftLbs: number;
  massStatus: BudgetStatus;
  currentTotalAmps: number;
  currentBreakerAmps: number;
  currentDriftAmps: number;
  currentStatus: BudgetStatus;
  trimSubsystem: string | null;
  trimAmountLbs: number | null;
  rationale: string;
  confidence: number;
  createdAt: string;
};
