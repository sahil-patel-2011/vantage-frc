// CD #42 — repeat-failure pattern detection. Surfaces "this subsystem has failed
// N times this season" from the structured FMEA log (and pit robot_failures as
// a fallback when FMEA is empty). Pure + SQL helpers; no invented counts.

import type { PoolClient } from "@neondatabase/serverless";
import { levelForRpn } from "./evaluate";
import type { FmeaFailure, FmeaLevel } from "./types";

/** Season failure count at or above this → alert. */
export const DEFAULT_REPEAT_THRESHOLD = 2;

function seasonYearNow(now: Date = new Date()) {
  return now.getUTCFullYear();
}

export type RepeatFailureAlert = {
  subsystemName: string;
  subsystemId: string | null;
  failureCount: number;
  openCount: number;
  distinctModes: number;
  maxRpn: number;
  level: FmeaLevel;
  /** Human-readable line for pit / command / CAD / Assistant. */
  message: string;
  recentTitles: string[];
  href: string;
};

export type RepeatFailureOptions = {
  threshold?: number;
  limit?: number;
  seasonYear?: number;
};

function clampScale(value: number) {
  return Math.min(10, Math.max(1, Math.round(value || 1)));
}

function rpnOf(failure: Pick<FmeaFailure, "occurrence" | "severity" | "detection">) {
  return clampScale(failure.occurrence) * clampScale(failure.severity) * clampScale(failure.detection);
}

export function formatRepeatFailureMessage(input: {
  subsystemName: string;
  failureCount: number;
  seasonYear?: number;
}): string {
  const season = input.seasonYear ? ` this season (${input.seasonYear})` : " this season";
  return `${input.subsystemName} has failed ${input.failureCount} time${input.failureCount === 1 ? "" : "s"}${season}`;
}

/**
 * Detect subsystems that keep failing. Threshold defaults to 2 — one-offs stay quiet.
 */
export function detectRepeatFailures(
  failures: FmeaFailure[],
  options: RepeatFailureOptions = {},
): RepeatFailureAlert[] {
  const threshold = options.threshold ?? DEFAULT_REPEAT_THRESHOLD;
  const limit = options.limit ?? 12;
  const seasonYear = options.seasonYear ?? failures[0]?.seasonYear;

  const groups = new Map<
    string,
    {
      subsystemName: string;
      subsystemId: string | null;
      failureCount: number;
      openCount: number;
      modes: Set<string>;
      maxRpn: number;
      titles: string[];
    }
  >();

  for (const failure of failures) {
    const key = failure.subsystemName.trim().toLowerCase() || "unknown";
    const entry = groups.get(key) ?? {
      subsystemName: failure.subsystemName.trim() || "Unknown",
      subsystemId: failure.subsystemId,
      failureCount: 0,
      openCount: 0,
      modes: new Set<string>(),
      maxRpn: 0,
      titles: [],
    };
    entry.failureCount += 1;
    if (failure.status === "open" || failure.status === "fixing") entry.openCount += 1;
    const mode = (failure.failureMode || failure.title).trim().toLowerCase();
    if (mode) entry.modes.add(mode);
    entry.maxRpn = Math.max(entry.maxRpn, rpnOf(failure));
    if (entry.titles.length < 3 && failure.title.trim()) entry.titles.push(failure.title.trim());
    if (!entry.subsystemId && failure.subsystemId) entry.subsystemId = failure.subsystemId;
    if (entry.subsystemName === "Unknown" && failure.subsystemName.trim()) {
      entry.subsystemName = failure.subsystemName.trim();
    }
    groups.set(key, entry);
  }

  return [...groups.values()]
    .filter((entry) => entry.failureCount >= threshold)
    .map((entry) => {
      const level = levelForRpn(entry.maxRpn);
      return {
        subsystemName: entry.subsystemName,
        subsystemId: entry.subsystemId,
        failureCount: entry.failureCount,
        openCount: entry.openCount,
        distinctModes: entry.modes.size,
        maxRpn: entry.maxRpn,
        level,
        message: formatRepeatFailureMessage({
          subsystemName: entry.subsystemName,
          failureCount: entry.failureCount,
          seasonYear,
        }),
        recentTitles: entry.titles,
        href: "/fmea",
      } satisfies RepeatFailureAlert;
    })
    .sort(
      (a, b) =>
        b.failureCount - a.failureCount ||
        b.maxRpn - a.maxRpn ||
        a.subsystemName.localeCompare(b.subsystemName),
    )
    .slice(0, limit);
}

/** Fallback when FMEA log is empty — count pit `robot_failures` this calendar year. */
export function detectRepeatFailuresFromPitLog(
  rows: Array<{ subsystem: string; severity: string; symptoms: string; occurredAt: string }>,
  options: RepeatFailureOptions = {},
): RepeatFailureAlert[] {
  const threshold = options.threshold ?? DEFAULT_REPEAT_THRESHOLD;
  const limit = options.limit ?? 12;
  const seasonYear = options.seasonYear ?? seasonYearNow();
  const severityWeight: Record<string, number> = {
    safety: 10,
    disabled: 8,
    degraded: 5,
    minor: 2,
  };

  const groups = new Map<
    string,
    { subsystemName: string; failureCount: number; openCount: number; maxWeight: number; titles: string[] }
  >();

  for (const row of rows) {
    const key = row.subsystem.trim().toLowerCase() || "unknown";
    const entry = groups.get(key) ?? {
      subsystemName: row.subsystem.trim() || "Unknown",
      failureCount: 0,
      openCount: 0,
      maxWeight: 0,
      titles: [],
    };
    entry.failureCount += 1;
    entry.openCount += 1;
    entry.maxWeight = Math.max(entry.maxWeight, severityWeight[row.severity] ?? 3);
    if (entry.titles.length < 3 && row.symptoms.trim()) entry.titles.push(row.symptoms.trim().slice(0, 80));
    groups.set(key, entry);
  }

  return [...groups.values()]
    .filter((entry) => entry.failureCount >= threshold)
    .map((entry) => {
      const maxRpn = entry.maxWeight * entry.maxWeight * 3;
      return {
        subsystemName: entry.subsystemName,
        subsystemId: null,
        failureCount: entry.failureCount,
        openCount: entry.openCount,
        distinctModes: entry.titles.length,
        maxRpn,
        level: levelForRpn(maxRpn),
        message: formatRepeatFailureMessage({
          subsystemName: entry.subsystemName,
          failureCount: entry.failureCount,
          seasonYear,
        }),
        recentTitles: entry.titles,
        href: "/pit",
      } satisfies RepeatFailureAlert;
    })
    .sort((a, b) => b.failureCount - a.failureCount || a.subsystemName.localeCompare(b.subsystemName))
    .slice(0, limit);
}

type FmeaRow = {
  id: string;
  title: string;
  failureMode: string;
  context: FmeaFailure["context"];
  subsystemId: string | null;
  subsystemName: string;
  occurrence: number;
  severity: number;
  detection: number;
  rootCause: string | null;
  fiveWhys: string | null;
  fix: string | null;
  status: FmeaFailure["status"];
  inspectionItemId: string | null;
  eventKey: string | null;
  matchKey: string | null;
  robotLabel: string;
  occurredAt: string;
  seasonYear: number;
};

/**
 * Load season FMEA rows and detect repeats. Falls back to pit robot_failures when
 * the FMEA table is missing or empty — never invents counts.
 */
export async function loadRepeatFailureAlerts(
  client: PoolClient,
  orgId: string,
  options: RepeatFailureOptions = {},
): Promise<RepeatFailureAlert[]> {
  const seasonYear = options.seasonYear ?? seasonYearNow();
  const threshold = options.threshold ?? DEFAULT_REPEAT_THRESHOLD;
  const limit = options.limit ?? 12;

  try {
    const fmea = await client.query<FmeaRow>(
      `SELECT f.id, f.title, f.failure_mode AS "failureMode", f.context,
              f.subsystem_id AS "subsystemId", f.subsystem_name AS "subsystemName",
              f.occurrence, f.severity, f.detection,
              f.root_cause AS "rootCause", f.five_whys AS "fiveWhys", f.fix,
              f.status, f.inspection_item_id AS "inspectionItemId",
              f.event_key AS "eventKey", f.match_key AS "matchKey",
              f.robot_label AS "robotLabel", f.occurred_at::text AS "occurredAt",
              f.season_year AS "seasonYear"
       FROM fmea_failures f
       WHERE f.org_id = $1::uuid AND f.season_year = $2
       ORDER BY f.occurred_at DESC
       LIMIT 500`,
      [orgId, seasonYear],
    );
    if (fmea.rows.length) {
      const failures: FmeaFailure[] = fmea.rows.map((row) => ({
        ...row,
        occurrence: Number(row.occurrence) || 1,
        severity: Number(row.severity) || 1,
        detection: Number(row.detection) || 1,
        recordedByName: null,
        // Parts linkage (0505) is not needed for repeat detection; the row is not selected here.
        inventoryItemId: null,
        partsConsumedQty: 0,
      }));
      return detectRepeatFailures(failures, { threshold, limit, seasonYear });
    }
  } catch {
    // fmea_failures not migrated yet
  }

  try {
    const pit = await client.query<{
      subsystem: string;
      severity: string;
      symptoms: string;
      occurredAt: string;
    }>(
      `SELECT subsystem, severity, symptoms, occurred_at::text AS "occurredAt"
       FROM robot_failures
       WHERE org_id = $1::uuid
         AND extract(year from occurred_at AT TIME ZONE 'UTC') = $2
       ORDER BY occurred_at DESC
       LIMIT 500`,
      [orgId, seasonYear],
    );
    return detectRepeatFailuresFromPitLog(pit.rows, { threshold, limit, seasonYear });
  } catch {
    return [];
  }
}
