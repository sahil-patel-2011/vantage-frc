// Pure, framework-free spare-parts exhaustion math. Everything here is deterministic and
// grounded only in the numbers the caller supplies — it never fabricates a value.
//
// Two things changed from the first version (which clamped a fixed 200-day season window):
//   * RATE — prefer what the inventory ledger actually recorded leaving the shelf
//     (reason='used' over a trailing window, null under MIN_LEDGER_EVENTS movements) and only
//     fall back to FMEA repeat-failure cadence. The source is labeled on every forecast.
//   * HORIZON — run to the org's next registered event (org_active_context -> events_ref
//     end_date). With no upcoming event the forecast uses an explicit rolling OFFSEASON window
//     instead of reporting "0 days remaining, no risk" just because a calendar window closed.
// compute-spare-forecast.ts wraps this with DB I/O; the API route and client render it.

import type {
  ExhaustionForecast,
  ForecastHorizon,
  ForecastHorizonSource,
  ForecastRateSource,
  ForecastUrgency,
  PurchaseRequestLineItem,
  PurchaseRequestStatus,
  SpareForecastLine,
} from "./types";

export const PURCHASE_REQUEST_STATUSES: PurchaseRequestStatus[] = ["draft", "approved", "ordered", "dismissed"];

/** FRC kickoff — the start of the FMEA observation period for a season. */
export const SEASON_START_MONTH_DAY = { month: 0, day: 1 } as const;

/** Rolling horizon used when the org has no upcoming registered event. */
export const OFFSEASON_HORIZON_DAYS = 90;
/** Trailing window the inventory ledger is sampled over for the observed rate. */
export const LEDGER_OBSERVATION_WINDOW_DAYS = 90;
/** Fewer 'used' movements than this and the ledger rate is NULL (not enough signal). */
export const MIN_LEDGER_EVENTS = 2;

/** A bin projected to hit zero within this many days is critical. */
export const CRITICAL_DAYS_THRESHOLD = 14;
/** A bin projected to hit zero within this many days is a warning. */
export const WARNING_DAYS_THRESHOLD = 30;

const DAY_MS = 86_400_000;

const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Days since kickoff of `seasonYear` as of `asOf`, never below 1 — the FMEA cadence denominator. */
export function seasonDaysElapsed(seasonYear: number, asOf: Date = new Date()): number {
  const start = Date.UTC(seasonYear, SEASON_START_MONTH_DAY.month, SEASON_START_MONTH_DAY.day);
  return Math.max(1, Math.round((asOf.getTime() - start) / DAY_MS));
}

/**
 * Horizon = days until the org's next registered event ends, or an explicit offseason window.
 * `nextEventEndsOn` is an ISO date (events_ref.end_date); a past date counts as no event.
 */
export function resolveHorizon(input: {
  asOf: Date;
  nextEventEndsOn: string | null;
  nextEventName?: string | null;
}): ForecastHorizon {
  const now = Date.UTC(input.asOf.getUTCFullYear(), input.asOf.getUTCMonth(), input.asOf.getUTCDate());
  const ends = input.nextEventEndsOn ? Date.parse(`${input.nextEventEndsOn}T00:00:00Z`) : Number.NaN;
  if (Number.isFinite(ends) && ends >= now) {
    return {
      horizonDays: Math.max(1, Math.round((ends - now) / DAY_MS)),
      horizonSource: "event",
      horizonEndsOn: isoDate(ends),
      eventName: input.nextEventName ?? null,
    };
  }
  return {
    horizonDays: OFFSEASON_HORIZON_DAYS,
    horizonSource: "offseason",
    horizonEndsOn: isoDate(now + OFFSEASON_HORIZON_DAYS * DAY_MS),
    eventName: null,
  };
}

/**
 * Observed consumption from the inventory ledger: units/day over the window, or NULL when
 * fewer than MIN_LEDGER_EVENTS 'used' movements exist (one movement is an anecdote, not a rate).
 */
export function observedRate(input: { usedQuantity: number; eventCount: number; windowDays: number }): number | null {
  const events = Math.max(0, Math.round(input.eventCount));
  if (events < MIN_LEDGER_EVENTS) return null;
  const windowDays = Math.max(1, Math.round(input.windowDays));
  const used = Math.max(0, input.usedQuantity);
  return round(used / windowDays, 4);
}

/** FMEA cadence: failures per elapsed season day. */
export function fmeaRate(input: { failureCount: number; daysElapsed: number }): number {
  const failures = Math.max(0, Math.round(input.failureCount));
  return round(failures / Math.max(1, Math.round(input.daysElapsed)), 4);
}

function urgencyFor(willExhaust: boolean, daysUntilExhaustion: number | null): ForecastUrgency {
  if (!willExhaust || daysUntilExhaustion == null) return "stable";
  if (daysUntilExhaustion <= CRITICAL_DAYS_THRESHOLD) return "critical";
  if (daysUntilExhaustion <= WARNING_DAYS_THRESHOLD) return "warning";
  return "watch";
}

export type ForecastInput = {
  quantityOnHand: number;
  /** Ledger-observed units/day, or null when the ledger has too little signal. */
  observedPerDay: number | null;
  /** FMEA failures/day for the matched subsystem (0 when unmatched). */
  fmeaPerDay: number;
  horizonDays: number;
  horizonSource: ForecastHorizonSource;
};

/**
 * Project whether a spare bin will exhaust inside the horizon. The ledger rate wins whenever
 * it exists; otherwise FMEA cadence. A zero rate from both sources is "stable" with the rate
 * source still labeled so the UI can say which signal was missing.
 */
export function forecastExhaustion(input: ForecastInput): ExhaustionForecast {
  const quantityOnHand = Math.max(0, input.quantityOnHand);
  const horizonDays = Math.max(1, Math.round(input.horizonDays));
  const rateSource: ForecastRateSource = input.observedPerDay != null ? "ledger" : "fmea";
  const consumptionPerDay = round(Math.max(0, input.observedPerDay ?? input.fmeaPerDay ?? 0), 4);

  const projectedConsumptionRemaining = round(consumptionPerDay * horizonDays, 2);
  const projectedShortfall = round(Math.max(0, projectedConsumptionRemaining - quantityOnHand), 2);
  const daysUntilExhaustion = consumptionPerDay > 0 ? round(quantityOnHand / consumptionPerDay, 1) : null;
  const willExhaust = consumptionPerDay > 0 && projectedShortfall > 0;

  // Order enough to cover the projected shortfall plus one cadence-cycle buffer.
  const recommendedOrderQty = willExhaust ? Math.ceil(projectedShortfall + consumptionPerDay) : 0;

  return {
    consumptionPerDay,
    rateSource,
    horizonDays,
    horizonSource: input.horizonSource,
    projectedConsumptionRemaining,
    projectedShortfall,
    daysUntilExhaustion,
    willExhaust,
    recommendedOrderQty,
    urgency: urgencyFor(willExhaust, daysUntilExhaustion),
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

export function rateSourceLabel(source: ForecastRateSource): string {
  return source === "ledger" ? "inventory ledger" : "FMEA cadence";
}

export function horizonLabel(forecast: Pick<ExhaustionForecast, "horizonDays" | "horizonSource">, eventName?: string | null): string {
  if (forecast.horizonSource === "event") {
    return `${forecast.horizonDays} day(s) until ${eventName ?? "the next registered event"} ends`;
  }
  return `rolling ${forecast.horizonDays}-day offseason window`;
}

/** Draft purchase-request line items from forecast lines that are actually projected to run out. */
export function draftPurchaseRequestLines(lines: SpareForecastLine[]): PurchaseRequestLineItem[] {
  return sortForecastLines(lines)
    .filter((line) => line.forecast.willExhaust)
    .map((line) => {
      const quantityToOrder = Math.max(1, line.forecast.recommendedOrderQty);
      const estimatedCost = round((line.unitCost ?? 0) * quantityToOrder, 2);
      const evidence =
        line.forecast.rateSource === "ledger"
          ? `${line.ledgerEventCount} inventory ledger movement(s) over the last ${LEDGER_OBSERVATION_WINDOW_DAYS} days`
          : `${line.failureCount} FMEA failure(s) on ${line.subsystem ?? "this subsystem"} this season`;
      return {
        itemId: line.itemId,
        itemName: line.itemName,
        quantityToOrder,
        unitCost: line.unitCost,
        estimatedCost,
        urgency: line.forecast.urgency,
        rationale: `${evidence} give ${line.forecast.consumptionPerDay} unit(s)/day, projecting ${line.forecast.projectedConsumptionRemaining} unit(s) consumed over a ${horizonLabel(line.forecast)}, against ${line.quantityOnHand} on hand.`,
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
