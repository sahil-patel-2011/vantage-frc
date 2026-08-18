// Pure helper functions for the in-match note timeline. No I/O — safe to unit test directly.

import type {
  MatchNoteCategory,
  MatchNoteEntry,
  MatchNotePhase,
  MatchNotesTimelineSummary,
  MatchTimeline,
} from "./types";

export const MATCH_NOTE_PHASES: MatchNotePhase[] = ["auto", "teleop", "endgame", "other"];
export const MATCH_NOTE_CATEGORIES: MatchNoteCategory[] = [
  "observation",
  "strategy",
  "issue",
  "highlight",
  "other",
];

export function matchNotePhaseLabel(phase: MatchNotePhase): string {
  switch (phase) {
    case "auto":
      return "Autonomous";
    case "teleop":
      return "Teleop";
    case "endgame":
      return "Endgame";
    default:
      return "Other";
  }
}

export function matchNoteCategoryLabel(category: MatchNoteCategory): string {
  switch (category) {
    case "observation":
      return "Observation";
    case "strategy":
      return "Strategy";
    case "issue":
      return "Issue";
    case "highlight":
      return "Highlight";
    default:
      return "Other";
  }
}

/** Format seconds-into-match as m:ss for the timeline display. */
export function formatClock(clockSeconds: number): string {
  const safe = Math.max(0, Math.round(clockSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Group flat entries into per-match timelines, each sorted by clock position. */
export function groupIntoTimelines(entries: MatchNoteEntry[]): MatchTimeline[] {
  const byMatch = new Map<string, MatchNoteEntry[]>();
  for (const entry of entries) {
    const key = entry.matchLabel;
    const bucket = byMatch.get(key);
    if (bucket) bucket.push(entry);
    else byMatch.set(key, [entry]);
  }

  const timelines: MatchTimeline[] = [];
  for (const [matchLabel, bucket] of byMatch) {
    const sorted = [...bucket].sort((a, b) => a.clockSeconds - b.clockSeconds);
    const lastNoteAt = bucket.reduce<string | null>((latest, item) => {
      if (!latest) return item.createdAt;
      return item.createdAt > latest ? item.createdAt : latest;
    }, null);
    timelines.push({
      matchLabel,
      matchKey: sorted[0]?.matchKey ?? null,
      teamNumber: sorted[0]?.teamNumber ?? null,
      entryCount: sorted.length,
      lastNoteAt,
      entries: sorted,
    });
  }

  return timelines.sort((a, b) => {
    const aTime = a.lastNoteAt ?? "";
    const bTime = b.lastNoteAt ?? "";
    return bTime.localeCompare(aTime);
  });
}

export function summarizeMatchNotes(entries: MatchNoteEntry[]): MatchNotesTimelineSummary {
  const categoryCounts = new Map<MatchNoteCategory, number>();
  const phaseCounts = new Map<MatchNotePhase, number>();
  const matchLabels = new Set<string>();

  for (const entry of entries) {
    matchLabels.add(entry.matchLabel);
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) ?? 0) + 1);
    phaseCounts.set(entry.phase, (phaseCounts.get(entry.phase) ?? 0) + 1);
  }

  return {
    totalEntries: entries.length,
    totalMatches: matchLabels.size,
    byCategory: MATCH_NOTE_CATEGORIES.filter((c) => categoryCounts.has(c)).map((category) => ({
      category,
      count: categoryCounts.get(category) ?? 0,
    })),
    byPhase: MATCH_NOTE_PHASES.filter((p) => phaseCounts.has(p)).map((phase) => ({
      phase,
      count: phaseCounts.get(phase) ?? 0,
    })),
  };
}

/** QRScout Action Tracker hold ranges: "12-18,22-30" (seconds). Empty/malformed stays empty. */
export function parseActionRanges(raw: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const token of raw.split(",")) {
    const match = /^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*$/.exec(token);
    if (!match) continue;
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    ranges.push({ start, end });
  }
  return ranges;
}

export function categoryActionCode(category: MatchNoteCategory): string {
  switch (category) {
    case "highlight":
      return "s";
    case "issue":
      return "d";
    case "strategy":
      return "p";
    case "observation":
      return "c";
    default:
      return "o";
  }
}

export type ActionInterval = { start: number; end: number; code: string };

export function actionIntervalsFromNotes(entries: MatchNoteEntry[]): ActionInterval[] {
  const intervals: ActionInterval[] = [];
  for (const entry of entries) {
    const ranges = parseActionRanges(entry.note);
    const code = categoryActionCode(entry.category);
    if (ranges.length > 0) {
      for (const range of ranges) intervals.push({ start: range.start, end: range.end, code });
      continue;
    }
    intervals.push({ start: entry.clockSeconds, end: entry.clockSeconds + 2, code });
  }
  return intervals;
}

const CODE_RANK: Record<string, number> = { s: 4, d: 3, p: 2, c: 1, o: 0 };

/** QRScout-style 1D strip: one cell per window, letter from overlapping actions. */
export function actionTrackerStrip(
  intervals: ActionInterval[],
  matchSeconds = 150,
  windowSeconds = 5,
): string[] {
  const cells: string[] = [];
  const length = Math.max(0, Math.round(matchSeconds));
  const window = Math.max(1, Math.round(windowSeconds));
  for (let start = 0; start < length; start += window) {
    const end = start + window;
    let best = "";
    let bestRank = -1;
    for (const interval of intervals) {
      if (interval.start < end && interval.end > start) {
        const rank = CODE_RANK[interval.code] ?? 0;
        if (rank > bestRank) {
          best = interval.code;
          bestRank = rank;
        }
      }
    }
    cells.push(best);
  }
  return cells;
}
