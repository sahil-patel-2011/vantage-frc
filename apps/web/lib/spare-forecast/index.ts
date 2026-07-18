// Pure, framework-free spare-parts exhaustion math. Everything here is deterministic and
// grounded only in the numbers the caller supplies (quantity on hand, FMEA repeat-failure
// count for the matched subsystem, and elapsed/remaining season days) — it never fabricates
// a value. compute-spare-forecast.ts wraps this with DB I/O; the API route and client render
// the results and let a team draft a purchase request from what would otherwise run out.

import type { ExhaustionForecast, ForecastUrgency, PurchaseRequestLineItem, SpareForecastLine } from "./types";

/** FRC build+competition season window used as the forecast horizon (Jan 1 kickoff through mid-summer champs). */
export const SEASON_START_MONTH_DAY = { month: 0, day: 1 } as const;
export const SEASON_LENGTH_DAYS = 200;

/** A bin projected to run out within this many days is critical. */
export const CRITICAL_DAYS_THRESHOLD = 14;
/** A bin projected to run out within this many days is a warning. */
export const WARNING_DAYS_THRESHOLD = 30;
/** A bin projected to run out within this many days (but still exhausting) is a watch item. */
export const WATCH_DAYS_THRESHOLD = 60;

const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

export function seasonWindow(seasonYear: number, asOf: Date = new Date()): { daysElapsed: number; daysRemaining: number } {
  const start = Date.UTC(seasonYear, SEASON_START_MONTH_DAY.month, SEASON_START_MONTH_DAY.day);
  const end = start + SEASON_LENGTH_DAYS * 86_400_000;
  const now = asOf.getTime();
  const daysElapsed = Math.max(1, Math.round((Math.min(Math.max(now, start), end) - start) / 86_400_000));
  const daysRemaining = Math.max(0, Math.round((end - Math.min(Math.max(now, start), end)) / 86_400_000));
  return { daysElapsed, daysRemaining };
}

function urgencyFor(willExhaust: boolean, daysRemaining: number, projectedShortfall: number): ForecastUrgency {
  if (!willExhaust || projectedShortfall <= 0) return "stable";
  if (daysRemaining <= CRITICAL_DAYS_THRESHOLD) return "critical";
  if (daysRemaining <= WARNING_DAYS_THRESHOLD) return "warning";
  if (daysRemaining <= WATCH_DAYS_THRESHOLD) return "watch";
  return "watch";
}

export type ForecastInput = {
  quantityOnHand: number;
  failureCount: number;
  daysElapsed: number;
  daysRemaining: number;
};

/** Project whether a spare bin will exhaust before the season ends, at its observed failure cadence. */
export function forecastExhaustion(input: ForecastInput): ExhaustionForecast {
  const quantityOnHand = Math.max(0, input.quantityOnHand);
  const failureCount = Math.max(0, Math.round(input.failureCount));
  const daysElapsed = Math.max(1, Math.round(input.daysElapsed));
  const daysRemaining = Math.max(0, Math.round(input.daysRemaining));

  const consumptionPerDay = round(failureCount / daysElapsed, 4);
  const projectedConsumptionRemaining = round(consumptionPerDay * daysRemaining, 2);
  const projectedShortfall = round(Math.max(0, projectedConsumptionRemaining - quantityOnHand), 2);
  const willExhaust = consumptionPerDay > 0 && projectedShortfall > 0;

  // Order enough to cover the projected shortfall plus one cadence-cycle buffer.
  const recommendedOrderQty = willExhaust ? Math.ceil(projectedShortfall + consumptionPerDay) : 0;

  return {
    consumptionPerDay,
    daysElapsed,
    daysRemaining,
    projectedConsumptionRemaining,
    projectedShortfall,
    willExhaust,
    recommendedOrderQty,
    urgency: urgencyFor(willExhaust, daysRemaining, projectedShortfall),
  };
}

const URGENCY_RANK: Record<ForecastUrgency, number> = { critical: 0, warning: 1, watch: 2, stable: 3 };

export function sortForecastLines(lines: SpareForecastLine[]): SpareForecastLine[] {
  return [...lines].sort((a, b) => {
    const rank = URGENCY_RANK[a.forecast.urgency] - URGENCY_RANK[b.forecast.urgency];
    if (rank !== 0) return rank;
    return b.forecast.projectedShortfall - a.forecast.projectedShortfall;
  });
}

/** Draft purchase-request line items from forecast lines that are actually projected to run out. */
export function draftPurchaseRequestLines(lines: SpareForecastLine[]): PurchaseRequestLineItem[] {
  return sortForecastLines(lines)
    .filter((line) => line.forecast.willExhaust)
    .map((line) => {
      const quantityToOrder = Math.max(1, line.forecast.recommendedOrderQty);
      const estimatedCost = round((line.unitCost ?? 0) * quantityToOrder, 2);
      return {
        itemId: line.itemId,
        itemName: line.itemName,
        quantityToOrder,
        unitCost: line.unitCost,
        estimatedCost,
        urgency: line.forecast.urgency,
        rationale: `${line.failureCount} FMEA failure(s) on ${line.subsystem ?? "this subsystem"} in ${line.forecast.daysElapsed} day(s) projects ${line.forecast.projectedConsumptionRemaining} unit(s) consumed over the ${line.forecast.daysRemaining} remaining season day(s), against ${line.quantityOnHand} on hand.`,
      };
    });
}

export function forecastUrgencyLabel(urgency: ForecastUrgency): string {
  switch (urgency) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "watch":
      return "Watch";
    default:
      return "Stable";
  }
}
