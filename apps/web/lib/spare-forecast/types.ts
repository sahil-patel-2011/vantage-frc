// Spare-parts failure-forecast domain types. Pure data shapes — no I/O, no framework imports.
// A forecast bin is one inventory "spare" item projected forward at a measured consumption
// rate — preferring what the inventory ledger actually recorded leaving the shelf, falling
// back to FMEA repeat-failure cadence — over a horizon that ends at the org's next registered
// event (or a rolling offseason window when there is none). Every number names its source.

export type ForecastUrgency = "critical" | "warning" | "watch" | "stable";

export type PurchaseRequestStatus = "draft" | "approved" | "ordered" | "dismissed";

/** Where the consumption rate came from. */
export type ForecastRateSource = "ledger" | "fmea";

/** Where the horizon came from. */
export type ForecastHorizonSource = "event" | "offseason";

export type ForecastHorizon = {
  horizonDays: number;
  horizonSource: ForecastHorizonSource;
  /** ISO date the horizon ends on. */
  horizonEndsOn: string;
  /** Name of the registered event the horizon runs to, when horizonSource = 'event'. */
  eventName: string | null;
};

/** Deterministic exhaustion projection for one spare bin, grounded only in supplied inputs. */
export type ExhaustionForecast = {
  consumptionPerDay: number;
  rateSource: ForecastRateSource;
  horizonDays: number;
  horizonSource: ForecastHorizonSource;
  projectedConsumptionRemaining: number;
  projectedShortfall: number;
  /** Days until the bin hits zero at this rate, or null when the rate is zero. */
  daysUntilExhaustion: number | null;
  willExhaust: boolean;
  recommendedOrderQty: number;
  urgency: ForecastUrgency;
};

/** A spare bin read from the existing inventory_items table (read-only join). */
export type SpareBin = {
  id: string;
  name: string;
  category: string;
  subsystem: string | null;
  quantityOnHand: number;
  unitCost: number | null;
  minQuantity: number;
};

/** FMEA repeat-failure count for a subsystem within the season, read from fmea_failures. */
export type SubsystemFailureRate = {
  subsystemName: string;
  failureCount: number;
};

export type SpareForecastLine = {
  itemId: string;
  itemName: string;
  category: string;
  subsystem: string | null;
  quantityOnHand: number;
  failureCount: number;
  /** inventory_transactions reason='used' movements inside the observation window. */
  ledgerEventCount: number;
  observedPerDay: number | null;
  fmeaPerDay: number;
  unitCost: number | null;
  forecast: ExhaustionForecast;
};

export type PurchaseRequestLineItem = {
  itemId: string;
  itemName: string;
  quantityToOrder: number;
  unitCost: number | null;
  estimatedCost: number;
  urgency: ForecastUrgency;
  rationale: string;
};

export type PurchaseRequestDraft = {
  id: string;
  seasonYear: number;
  title: string;
  status: PurchaseRequestStatus;
  lineItems: PurchaseRequestLineItem[];
  totalEstimatedCost: number;
  rationale: string;
  createdAt: string;
  updatedAt: string;
};
