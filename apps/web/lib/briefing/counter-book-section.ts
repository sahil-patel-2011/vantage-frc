// Counter-books on the ONE pre-match briefing.
//
// /counter-book already generates a grounded one-page counter-strategy per opponent from this
// org's own scouted rows (counter_book_reports, migration 0204). Before this, the briefing never
// read it, so a team that had done the work still had to open a second tab mid-match. These pure
// helpers pick the newest report per opponent in the selected match and trim it to what fits on a
// pre-match card. No report for an opponent means no row — never a fabricated tendency.

import type { CounterBookFailureTrigger, CounterBookTendency } from "../counter-book/types";
import type { BriefingCounterBook } from "./types";

/** Row shape as read from counter_book_reports (JSONB columns arrive already parsed). */
export type CounterBookReportRow = {
  id: string;
  teamKey: string;
  teamNumber: number | null;
  eventKey: string | null;
  title: string;
  matchesScouted: number | string | null;
  tendencies: unknown;
  failureTriggers: unknown;
  counterPlan: string | null;
  summary: string | null;
  createdAt: string | null;
};

function tendencyList(value: unknown, max: number): CounterBookTendency[] {
  if (!Array.isArray(value)) return [];
  const rows: CounterBookTendency[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field.trim() : "";
    const average = Number(record.average);
    const sampleSize = Number(record.sampleSize);
    if (!field || !Number.isFinite(average) || !Number.isFinite(sampleSize) || sampleSize <= 0) {
      continue;
    }
    const variability = Number(record.variability);
    rows.push({
      field,
      average,
      sampleSize: Math.floor(sampleSize),
      variability: Number.isFinite(variability) ? variability : 0,
    });
  }
  // Highest average first: the thing the opponent actually does most.
  return rows.sort((a, b) => b.average - a.average).slice(0, max);
}

function triggerList(value: unknown, max: number): CounterBookFailureTrigger[] {
  if (!Array.isArray(value)) return [];
  const rows: CounterBookFailureTrigger[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field.trim() : "";
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    if (!field || !detail) continue;
    const variability = Number(record.variability);
    rows.push({ field, detail, variability: Number.isFinite(variability) ? variability : 0 });
  }
  return rows.sort((a, b) => b.variability - a.variability).slice(0, max);
}

/**
 * Newest usable report per opponent, in lineup order.
 *
 * `rows` may contain several generations for the same team; the first row seen for a team wins, so
 * callers must pass them newest-first (the SQL orders by created_at DESC). A report with neither a
 * tendency, a failure trigger nor a counter plan carries no information and is dropped rather than
 * rendered as an empty card.
 */
export function selectBriefingCounterBooks(
  rows: CounterBookReportRow[],
  opponentKeys: string[],
): BriefingCounterBook[] {
  const wanted = new Set(opponentKeys);
  const seen = new Set<string>();
  const byTeam = new Map<string, BriefingCounterBook>();

  for (const row of rows) {
    const teamKey = typeof row.teamKey === "string" ? row.teamKey.trim() : "";
    if (!teamKey || !wanted.has(teamKey) || seen.has(teamKey)) continue;
    seen.add(teamKey);

    const tendencies = tendencyList(row.tendencies, 4);
    const failureTriggers = triggerList(row.failureTriggers, 3);
    const counterPlan = (row.counterPlan ?? "").trim();
    const summary = (row.summary ?? "").trim();
    if (!tendencies.length && !failureTriggers.length && !counterPlan) continue;

    const matchesScouted = Number(row.matchesScouted);
    byTeam.set(teamKey, {
      id: row.id,
      teamKey,
      teamNumber: row.teamNumber ?? null,
      title: row.title,
      matchesScouted: Number.isFinite(matchesScouted) ? Math.max(0, Math.floor(matchesScouted)) : 0,
      tendencies,
      failureTriggers,
      counterPlan,
      summary,
      createdAt: row.createdAt ?? null,
    });
  }

  return opponentKeys
    .map((key) => byTeam.get(key))
    .filter((entry): entry is BriefingCounterBook => Boolean(entry));
}

/**
 * Which opponents in this match have no counter-book yet — the briefing shows this as the exact
 * setup step ("generate a counter-book for 1234") instead of inventing opponent tendencies.
 */
export function counterBookGaps(
  reports: BriefingCounterBook[],
  opponentKeys: string[],
): string[] {
  const covered = new Set(reports.map((report) => report.teamKey));
  return opponentKeys.filter((key) => key && !covered.has(key));
}
