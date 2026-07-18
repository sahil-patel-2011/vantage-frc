// Pure, framework-free budget-drift math. Everything here is deterministic and grounded only in
// the numbers the caller supplies (summed weight_components / weight_settings limit and summed
// power_loads / breaker budget) — it never fabricates a value.
// compute-budget-reconciler.ts wraps this with DB I/O; the API route and client render results.

import type { BudgetStatus, CurrentReading, MassReading, SubsystemContribution, TrimProposal } from "./types";

/** Drift below this magnitude (as a fraction of limit) is treated as on-target, not over/under. */
export const DRIFT_NOISE_FLOOR_PCT = 0.01;
/** Trim proposals cap at this fraction of a subsystem's mass — never suggest gutting a subsystem. */
export const MAX_TRIM_FRACTION = 0.25;

const round = (value: number, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function statusFor(driftLbs: number, limitLbs: number): BudgetStatus {
  const driftPct = limitLbs > 0 ? driftLbs / limitLbs : 0;
  if (driftPct > DRIFT_NOISE_FLOOR_PCT) return "over";
  if (driftPct < -DRIFT_NOISE_FLOOR_PCT) return "under";
  return "on_target";
}

/** Sum as-designed mass across subsystems against the season's weight limit. */
export function computeMassReading(totalLbs: number, limitLbs: number): MassReading {
  const total = Math.max(0, totalLbs);
  const limit = Math.max(0, limitLbs);
  const driftLbs = round(total - limit);
  const driftPct = limit > 0 ? round(driftLbs / limit, 4) : 0;
  return { totalLbs: round(total), limitLbs: round(limit), driftLbs, driftPct, status: statusFor(driftLbs, limit) };
}

/** Sum typical current draw across subsystems against the summed branch-breaker budget. */
export function computeCurrentReading(totalAmps: number, breakerAmps: number): CurrentReading {
  const total = Math.max(0, totalAmps);
  const breaker = Math.max(0, breakerAmps);
  const driftAmps = round(total - breaker);
  const driftPct = breaker > 0 ? round(driftAmps / breaker, 4) : 0;
  return {
    totalAmps: round(total),
    breakerAmps: round(breaker),
    driftAmps,
    driftPct,
    status: statusFor(driftAmps, breaker),
  };
}

/**
 * When mass is over budget, propose trimming the single heaviest subsystem — the one where a
 * modest percentage cut closes the most drift with the smallest redesign footprint. Returns null
 * when there is nothing to trim (on/under budget, or no subsystem data).
 */
export function proposeTrimSubsystem(
  contributions: SubsystemContribution[],
  massReading: MassReading,
): TrimProposal | null {
  if (massReading.status !== "over" || massReading.driftLbs <= 0) return null;
  const candidates = contributions.filter((c) => c.massLbs > 0);
  if (candidates.length === 0) return null;

  const heaviest = [...candidates].sort((a, b) => b.massLbs - a.massLbs)[0]!;
  const recommendedTrimLbs = round(Math.min(heaviest.massLbs * MAX_TRIM_FRACTION, massReading.driftLbs));
  if (recommendedTrimLbs <= 0) return null;

  return {
    subsystem: heaviest.subsystem,
    currentMassLbs: round(heaviest.massLbs),
    recommendedTrimLbs,
    rationale:
      `${heaviest.subsystem} carries the largest as-designed mass of any subsystem ` +
      `(${round(heaviest.massLbs)} lb) against a ${round(massReading.driftLbs)} lb overage — ` +
      `trimming ~${recommendedTrimLbs} lb here closes the most drift with the smallest redesign footprint.`,
  };
}

/** Confidence in the trim proposal: higher when the heaviest subsystem covers most of the drift. */
export function trimConfidence(proposal: TrimProposal | null, massReading: MassReading): number {
  if (!proposal || massReading.driftLbs <= 0) return 0;
  const coverage = Math.min(1, proposal.recommendedTrimLbs / massReading.driftLbs);
  return round(0.4 + coverage * 0.5, 3);
}

export function budgetStatusLabel(status: BudgetStatus): string {
  switch (status) {
    case "over":
      return "Over budget";
    case "under":
      return "Under budget";
    default:
      return "On target";
  }
}
