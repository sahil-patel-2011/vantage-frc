/**
 * Metric thread reference: coarse pitch, ISO 273 clearance holes, tap drills.
 *
 * The clearance table is ISO 273. Its "normal"/medium series gives 3.4 mm for an
 * M3, which is exactly the nominal the owner's calibration case starts from.
 * https://mechcodex.com/reference/metric-clearance-hole-sizes
 *
 * Tap drills are not a separate lookup table: for a full-depth ISO coarse thread
 * the tap drill is the major diameter minus the pitch, which reproduces every
 * standard published value (M3 -> 2.5, M4 -> 3.3, M5 -> 4.2, M6 -> 5.0,
 * M8 -> 6.75). They are computed rather than copied so the two can never drift.
 */

import type { ClearanceFit, MetricThread } from "./types";

export const METRIC_THREADS: readonly MetricThread[] = ["M2", "M2.5", "M3", "M4", "M5", "M6", "M8"];

/** Major (nominal) diameter in mm. */
const MAJOR_DIAMETER_MM: Record<MetricThread, number> = {
  M2: 2,
  "M2.5": 2.5,
  M3: 3,
  M4: 4,
  M5: 5,
  M6: 6,
  M8: 8,
};

/** ISO coarse-series pitch in mm. */
const COARSE_PITCH_MM: Record<MetricThread, number> = {
  M2: 0.4,
  "M2.5": 0.45,
  M3: 0.5,
  M4: 0.7,
  M5: 0.8,
  M6: 1.0,
  M8: 1.25,
};

/** ISO 273 clearance holes, mm. */
const CLEARANCE_MM: Record<MetricThread, Record<ClearanceFit, number>> = {
  M2: { close: 2.2, normal: 2.4, loose: 2.6 },
  "M2.5": { close: 2.7, normal: 2.9, loose: 3.1 },
  M3: { close: 3.2, normal: 3.4, loose: 3.6 },
  M4: { close: 4.3, normal: 4.5, loose: 4.8 },
  M5: { close: 5.3, normal: 5.5, loose: 5.8 },
  M6: { close: 6.4, normal: 6.6, loose: 7.0 },
  M8: { close: 8.4, normal: 9.0, loose: 10.0 },
};

export function majorDiameterMm(thread: MetricThread): number {
  return MAJOR_DIAMETER_MM[thread];
}

export function coarsePitchMm(thread: MetricThread): number {
  return COARSE_PITCH_MM[thread];
}

/** ISO 273 clearance diameter. Defaults to the general-purpose "normal" series. */
export function clearanceHoleMm(thread: MetricThread, fit: ClearanceFit = "normal"): number {
  return CLEARANCE_MM[thread][fit];
}

/**
 * Tap drill for a full-depth ISO coarse thread: major diameter minus pitch.
 * Rounded to 0.01 mm so M8 reports 6.75 rather than 6.750000000000001.
 */
export function tapDrillMm(thread: MetricThread): number {
  const raw = MAJOR_DIAMETER_MM[thread] - COARSE_PITCH_MM[thread];
  return Math.round(raw * 100) / 100;
}

export function isMetricThread(value: string): value is MetricThread {
  return (METRIC_THREADS as readonly string[]).includes(value);
}
