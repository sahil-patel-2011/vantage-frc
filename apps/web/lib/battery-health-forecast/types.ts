// Battery health forecast domain types. Pure data shapes — no I/O, no framework imports.
// Predicts battery retirement from logged cycle-count / internal-resistance (IR) reading
// history: a rising IR trend against a threshold projects a retirement cycle and date.

export type BatteryLifecycleStatus = "active" | "retired";

export type BatteryHealthRecord = {
  id: string;
  label: string;
  serialNumber: string | null;
  status: BatteryLifecycleStatus;
  putInServiceOn: string | null;
  retiredOn: string | null;
  notes: string | null;
  createdAt: string;
};

export type BatteryHealthReading = {
  id: string;
  batteryId: string;
  recordedAt: string;
  cycleCount: number;
  internalResistanceMohm: number;
  voltage: number | null;
  notes: string | null;
};

/** Forecast confidence/urgency tier, derived only from the logged reading history. */
export type ForecastStatus = "insufficient_data" | "healthy" | "watch" | "retire_soon" | "overdue";

export type ForecastThresholds = {
  /** IR (mOhm) at which a pack is considered end-of-life. Default 20. */
  resistanceThresholdMohm: number;
  /** Minimum readings required before a trend/forecast is computed. Default 3. */
  minReadingsForTrend: number;
  /** Days-to-threshold at or below which status becomes "retire_soon". Default 21. */
  watchWindowDays: number;
};

export type BatteryForecast = {
  batteryId: string;
  label: string;
  serialNumber: string | null;
  status: BatteryLifecycleStatus;
  readingsCount: number;
  latestCycleCount: number | null;
  latestResistanceMohm: number | null;
  latestReadingAt: string | null;
  /** mOhm of IR increase per charge cycle, from a least-squares fit over readings. Null if not enough data. */
  resistanceSlopePerCycle: number | null;
  /** Observed charge cycles per calendar day, from first to last reading. Null if not enough data. */
  cyclesPerDay: number | null;
  /** Projected cumulative cycle count at which IR crosses the threshold. */
  projectedRetirementCycle: number | null;
  /** ISO date (YYYY-MM-DD) estimate of when that cycle count will be reached. */
  projectedRetirementDate: string | null;
  /** Calendar days from now until the projected retirement date. */
  daysRemaining: number | null;
  forecastStatus: ForecastStatus;
};

export type FleetSummary = {
  totalBatteries: number;
  activeBatteries: number;
  retiredBatteries: number;
  insufficientDataCount: number;
  healthyCount: number;
  watchCount: number;
  retireSoonCount: number;
  overdueCount: number;
  /** 0..1 blend of how much of the active fleet is healthy vs. approaching/past end-of-life. */
  fleetReadiness: number;
};
