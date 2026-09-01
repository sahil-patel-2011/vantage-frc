// Spare-parts failure-forecast domain types. Pure data shapes — no I/O, no framework imports.
// A forecast bin is one inventory "spare" item cross-referenced against FMEA failure repeat
// rate for its subsystem to project when it will run out before the season ends.

export type ForecastUrgency = "critical" | "warning" | "watch" | "stable";

/** Whether the FRC 200-day season window is still open for remaining-day projections. */
export type SeasonHorizon = "in_season" | "offseason";

export type PurchaseRequestStatus = "draft" | "approved" | "ordered" | "dismissed";

/**
 * Deterministic exhaustion projection for one spare bin, grounded only in supplied inputs.
 * Remaining-season fields are null in offseason — never "no risk" from a closed 200-day window.
 */
export type ExhaustionForecast = {
  consumptionPerDay: number;
  daysElapsed: number;
  daysRemaining: number | null;
  projectedConsumptionRemaining: number | null;
  projectedShortfall: number | null;
  willExhaust: boolean | null;
  recommendedOrderQty: number;
  urgency: ForecastUrgency | null;
  horizon: SeasonHorizon;
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
