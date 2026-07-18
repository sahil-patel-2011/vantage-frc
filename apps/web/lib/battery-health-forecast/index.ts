// Battery health forecast: pure aggregation/regression over logged readings. Deterministic
// given its input and an explicit "now" — no hidden clock, no fabricated numbers when there
// isn't enough reading history to project a trend.

import type {
  BatteryForecast,
  BatteryHealthReading,
  BatteryHealthRecord,
  FleetSummary,
  ForecastStatus,
  ForecastThresholds,
} from "./types";

export * from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round2 = (value: number) => Math.round(value * 100) / 100;
const MS_PER_DAY = 86_400_000;

export const DEFAULT_THRESHOLDS: ForecastThresholds = {
  resistanceThresholdMohm: 20,
  minReadingsForTrend: 3,
  watchWindowDays: 21,
};

/**
 * Least-squares linear fit y = slope*x + intercept. Returns null when there are fewer
 * than 2 distinct x values (no meaningful slope can be estimated).
 */
export function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const xs = points.map((p) => p.x);
  if (new Set(xs).size < 2) return null;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

function forecastStatusFor(
  battery: BatteryHealthRecord,
  daysRemaining: number | null,
  latestResistance: number | null,
  thresholds: ForecastThresholds,
): ForecastStatus {
  if (battery.status === "retired") return "healthy";
  if (daysRemaining == null || latestResistance == null) return "insufficient_data";
  if (latestResistance >= thresholds.resistanceThresholdMohm || daysRemaining <= 0) return "overdue";
  if (daysRemaining <= thresholds.watchWindowDays) return "retire_soon";
  if (daysRemaining <= thresholds.watchWindowDays * 3) return "watch";
  return "healthy";
}

/**
 * Project a single battery's retirement point from its reading history. Uses a least-squares
 * fit of IR (mOhm) against cycle count to find the resistance trend, and observed cycles/day
 * (first reading to last reading) to translate the projected cycle count into a calendar date.
 * Never fabricates a projection: with too few readings, or a flat/declining IR trend, the
 * projection fields are null and status is "insufficient_data".
 */
export function computeBatteryForecast(
  battery: BatteryHealthRecord,
  readings: BatteryHealthReading[],
  thresholds: Partial<ForecastThresholds> = {},
  now: Date = new Date(),
): BatteryForecast {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const sorted = [...readings].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const latest = sorted[sorted.length - 1] ?? null;

  const base: BatteryForecast = {
    batteryId: battery.id,
    label: battery.label,
    serialNumber: battery.serialNumber,
    status: battery.status,
    readingsCount: sorted.length,
    latestCycleCount: latest ? latest.cycleCount : null,
    latestResistanceMohm: latest ? latest.internalResistanceMohm : null,
    latestReadingAt: latest ? latest.recordedAt : null,
    resistanceSlopePerCycle: null,
    cyclesPerDay: null,
    projectedRetirementCycle: null,
    projectedRetirementDate: null,
    daysRemaining: null,
    forecastStatus: "insufficient_data",
  };

  if (battery.status === "retired") {
    return { ...base, forecastStatus: "healthy" };
  }

  if (sorted.length < t.minReadingsForTrend || !latest) {
    return base;
  }

  const first = sorted[0]!;
  const fit = linearRegression(sorted.map((r) => ({ x: r.cycleCount, y: r.internalResistanceMohm })));
  const cycleSpan = latest.cycleCount - first.cycleCount;
  const daySpan = (new Date(latest.recordedAt).getTime() - new Date(first.recordedAt).getTime()) / MS_PER_DAY;
  const cyclesPerDay = cycleSpan > 0 && daySpan > 0 ? cycleSpan / daySpan : null;

  if (!fit || fit.slope <= 0 || !cyclesPerDay) {
    return { ...base, cyclesPerDay: cyclesPerDay != null ? round2(cyclesPerDay) : null };
  }

  const cyclesRemaining = (t.resistanceThresholdMohm - latest.internalResistanceMohm) / fit.slope;
  const projectedRetirementCycle = Math.max(latest.cycleCount, Math.round(latest.cycleCount + cyclesRemaining));
  const daysRemainingRaw = cyclesRemaining / cyclesPerDay;
  const daysRemaining = Math.round(daysRemainingRaw);
  const projectedDate = new Date(now.getTime() + daysRemainingRaw * MS_PER_DAY);
  const projectedRetirementDate = Number.isFinite(projectedDate.getTime())
    ? projectedDate.toISOString().slice(0, 10)
    : null;

  const forecast: BatteryForecast = {
    ...base,
    resistanceSlopePerCycle: round2(fit.slope),
    cyclesPerDay: round2(cyclesPerDay),
    projectedRetirementCycle,
    projectedRetirementDate,
    daysRemaining,
    forecastStatus: "insufficient_data",
  };
  forecast.forecastStatus = forecastStatusFor(battery, daysRemaining, latest.internalResistanceMohm, t);
  return forecast;
}

/** Aggregate per-battery forecasts into a fleet-wide summary and readiness signal. */
export function summarizeFleet(forecasts: BatteryForecast[]): FleetSummary {
  const active = forecasts.filter((f) => f.status === "active");
  const retired = forecasts.filter((f) => f.status === "retired");

  const counts: Record<ForecastStatus, number> = {
    insufficient_data: 0,
    healthy: 0,
    watch: 0,
    retire_soon: 0,
    overdue: 0,
  };
  for (const f of active) counts[f.forecastStatus] += 1;

  const scored = active.length - counts.insufficient_data;
  const weightedHealth = counts.healthy * 1 + counts.watch * 0.6 + counts.retire_soon * 0.25 + counts.overdue * 0;
  const fleetReadiness = scored > 0 ? clamp01(round2(weightedHealth / scored)) : 0;

  return {
    totalBatteries: forecasts.length,
    activeBatteries: active.length,
    retiredBatteries: retired.length,
    insufficientDataCount: counts.insufficient_data,
    healthyCount: counts.healthy,
    watchCount: counts.watch,
    retireSoonCount: counts.retire_soon,
    overdueCount: counts.overdue,
    fleetReadiness,
  };
}

export function forecastStatusLabel(status: ForecastStatus): string {
  const labels: Record<ForecastStatus, string> = {
    insufficient_data: "Insufficient data",
    healthy: "Healthy",
    watch: "Watch",
    retire_soon: "Retire soon",
    overdue: "Overdue for retirement",
  };
  return labels[status];
}
