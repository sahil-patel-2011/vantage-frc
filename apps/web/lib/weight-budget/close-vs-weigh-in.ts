/**
 * Planned weight-budget lb vs the ONE weigh-in scale log.
 *
 * Weight budget already sums `weight_components` (planned). Robot weigh-in already
 * stores `robot_weigh_in_entries` (scale). This is the close between those two —
 * not a third weight store, not `robot_weights`, not a bumper-adjusted invented
 * reading. No entries means the scale side stays blank; never a default lb.
 */

export type WeighInScaleEntry = {
  weightLbs: number;
  weighedOn: string;
};

export type PlannedVsLoggedClose = {
  /** Σ(weight_lbs × quantity) from the weight-budget components. */
  plannedLbs: number;
  /** Latest scale reading. Null when no weigh-in entries exist. */
  loggedLbs: number | null;
  loggedOn: string | null;
  /** Scale minus planned. Null when there is no scale reading. */
  deltaLbs: number | null;
};

export const NO_WEIGH_IN_CLOSE_CUE =
  "No weigh-in entries yet — planned vs scale stays blank until you log a reading.";

const round2 = (value: number) => Math.round(value * 100) / 100;

function usableEntry(entry: WeighInScaleEntry): boolean {
  return (
    Number.isFinite(entry.weightLbs) &&
    entry.weightLbs >= 0 &&
    typeof entry.weighedOn === "string" &&
    entry.weighedOn.trim().length > 0
  );
}

/** Newest scale row by `weighedOn`. Stable on ties so a newest-first caller keeps its latest. */
export function latestScaleEntry(
  entries: readonly WeighInScaleEntry[],
): WeighInScaleEntry | null {
  const usable = entries.filter(usableEntry);
  if (usable.length === 0) return null;
  return [...usable].sort((a, b) => b.weighedOn.localeCompare(a.weighedOn))[0] ?? null;
}

/**
 * One comparison: planned component total vs the latest weigh-in.
 * Empty / unusable entries → logged fields stay null. Never invents a scale lb.
 */
export function closePlannedAgainstWeighIn(
  plannedLbs: number,
  entries: readonly WeighInScaleEntry[],
): PlannedVsLoggedClose {
  const planned = Number.isFinite(plannedLbs) ? round2(Math.max(0, plannedLbs)) : 0;
  const latest = latestScaleEntry(entries);
  if (!latest) {
    return { plannedLbs: planned, loggedLbs: null, loggedOn: null, deltaLbs: null };
  }
  const logged = round2(latest.weightLbs);
  return {
    plannedLbs: planned,
    loggedLbs: logged,
    loggedOn: latest.weighedOn,
    deltaLbs: round2(logged - planned),
  };
}

export function isCloseBlank(close: PlannedVsLoggedClose): boolean {
  return close.loggedLbs == null;
}

/**
 * Pull scale rows from the existing `/api/robot-weigh-in` live payload.
 * Setup / missing / malformed payloads yield [] — blank close, not a fabricated log.
 */
export function scaleEntriesFromWeighInPayload(raw: unknown): WeighInScaleEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const payload = raw as { status?: unknown; entries?: unknown };
  if (payload.status !== "live" || !Array.isArray(payload.entries)) return [];

  const entries: WeighInScaleEntry[] = [];
  for (const row of payload.entries) {
    if (!row || typeof row !== "object") continue;
    const record = row as { weightLbs?: unknown; weighedOn?: unknown };
    const weightLbs = Number(record.weightLbs);
    const weighedOn = typeof record.weighedOn === "string" ? record.weighedOn.trim() : "";
    if (!Number.isFinite(weightLbs) || weightLbs < 0 || !weighedOn) continue;
    entries.push({ weightLbs, weighedOn });
  }
  return entries;
}
