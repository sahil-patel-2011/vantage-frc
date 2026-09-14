// Pure, framework-free spare-parts exhaustion math. Everything here is deterministic and
// grounded only in the numbers the caller supplies (quantity on hand, FMEA repeat-failure
// count for the matched subsystem, and elapsed/remaining season days) — it never fabricates
// a value. compute-spare-forecast.ts wraps this with DB I/O; the API route and client render
// the results and let a team draft a purchase request from what would otherwise run out.

import type {
  ExhaustionForecast,
  ForecastUrgency,
  PurchaseRequestLineItem,
  PurchaseRequestStatus,
  SeasonHorizon,
  SpareForecastLine,
} from "./types";

export type { SeasonHorizon };

export const PURCHASE_REQUEST_STATUSES: PurchaseRequestStatus[] = ["draft", "approved", "ordered", "dismissed"];

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

export type SeasonWindow = {
  daysElapsed: number;
  /** Null once the 200-day window has closed — never clamp remaining days to 0. */
  daysRemaining: number | null;
  horizon: SeasonHorizon;
};

/**
 * Season cadence window. After day 200, remaining-season risk is unknown (offseason)
 * rather than a clamped 0 that would look like "no risk".
 */
export function seasonWindow(seasonYear: number, asOf: Date = new Date()): SeasonWindow {
  const start = Date.UTC(seasonYear, SEASON_START_MONTH_DAY.month, SEASON_START_MONTH_DAY.day);
  const end = start + SEASON_LENGTH_DAYS * 86_400_000;
  const now = asOf.getTime();

  if (now < start) {
    return { daysElapsed: 1, daysRemaining: SEASON_LENGTH_DAYS, horizon: "in_season" };
  }

  if (now >= end) {
    return { daysElapsed: SEASON_LENGTH_DAYS, daysRemaining: null, horizon: "offseason" };
  }

  const daysElapsed = Math.max(1, Math.round((now - start) / 86_400_000));
  const daysRemaining = Math.round((end - now) / 86_400_000);
  if (daysRemaining <= 0) {
    return { daysElapsed: SEASON_LENGTH_DAYS, daysRemaining: null, horizon: "offseason" };
  }
  return { daysElapsed, daysRemaining, horizon: "in_season" };
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
  daysRemaining: number | null;
};

/**
 * Project whether a spare bin will exhaust before the season ends, at its observed failure cadence.
 * Offseason / a closed 200-day window yields null remaining-season risk — never "stable" from a clamp.
 */
export function forecastExhaustion(input: ForecastInput): ExhaustionForecast {
  const quantityOnHand = Math.max(0, input.quantityOnHand);
  const failureCount = Math.max(0, Math.round(input.failureCount));
  const daysElapsed = Math.max(1, Math.round(input.daysElapsed));
  const remainingInput = input.daysRemaining;
  const horizonClosed = remainingInput == null || remainingInput <= 0;
  const consumptionPerDay = round(failureCount / daysElapsed, 4);

  if (horizonClosed) {
    return {
      consumptionPerDay,
      daysElapsed,
      daysRemaining: null,
      projectedConsumptionRemaining: null,
      projectedShortfall: null,
      willExhaust: null,
      recommendedOrderQty: 0,
      urgency: failureCount > 0 ? null : "stable",
      horizon: "offseason",
    };
  }

  const daysRemaining = Math.round(remainingInput);
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
    horizon: "in_season",
  };
}

const URGENCY_RANK: Record<ForecastUrgency, number> = { critical: 0, warning: 1, watch: 2, stable: 3 };

function urgencyRank(urgency: ForecastUrgency | null): number {
  return urgency == null ? -1 : URGENCY_RANK[urgency];
}

export function sortForecastLines(lines: SpareForecastLine[]): SpareForecastLine[] {
  return [...lines].sort((a, b) => {
    const rank = urgencyRank(a.forecast.urgency) - urgencyRank(b.forecast.urgency);
    if (rank !== 0) return rank;
    return (b.forecast.projectedShortfall ?? 0) - (a.forecast.projectedShortfall ?? 0);
  });
}

/** Draft purchase-request line items from forecast lines that are actually projected to run out. */
export function draftPurchaseRequestLines(lines: SpareForecastLine[]): PurchaseRequestLineItem[] {
  return sortForecastLines(lines)
    .filter((line) => line.forecast.willExhaust === true && line.forecast.urgency != null)
    .map((line) => {
      const quantityToOrder = Math.max(1, line.forecast.recommendedOrderQty);
      const estimatedCost = round((line.unitCost ?? 0) * quantityToOrder, 2);
      return {
        itemId: line.itemId,
        itemName: line.itemName,
        quantityToOrder,
        unitCost: line.unitCost,
        estimatedCost,
        urgency: line.forecast.urgency ?? "watch",
        rationale: `${line.failureCount} logged failure(s) on ${line.subsystem ?? "this subsystem"} in ${line.forecast.daysElapsed} day(s) projects ${line.forecast.projectedConsumptionRemaining} unit(s) consumed over the ${line.forecast.daysRemaining} remaining season day(s), against ${line.quantityOnHand} on hand.`,
      };
    });
}

export function forecastUrgencyLabel(urgency: ForecastUrgency | null): string {
  switch (urgency) {
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "watch":
      return "Watch";
    case "stable":
      return "Stable";
    default:
      return "No season horizon";
  }
}
