// Pure helper functions for the in-match note timeline. No I/O — safe to unit test directly.

import type {
  MatchNoteCategory,
  MatchNoteEntry,
  MatchNotePhase,
  MatchNoteSource,
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

export function matchNoteSourceLabel(source: MatchNoteSource): string {
  switch (source) {
    case "human":
      return "Logged";
    case "video":
      return "From video";
    default: {
      const _never: never = source;
      return _never;
    }
  }
}

/** FRC match clock: 15s auto, teleop through 2:15, last 20s called endgame. */
export function phaseFromMatchClock(tSec: number): MatchNotePhase {
  if (tSec < 15) return "auto";
  if (tSec >= 135) return "endgame";
  return "teleop";
}

function categoryFromVideoKind(kind: string | undefined): MatchNoteCategory {
  const key = (kind ?? "").toLowerCase();
  if (key.includes("climb") || key.includes("highlight") || key.includes("score")) return "highlight";
  if (key.includes("foul") || key.includes("stall") || key.includes("break")) return "issue";
  if (key.includes("defense") || key.includes("defend")) return "strategy";
  return "observation";
}

function teamNumberFromTeamKey(teamKey: string | undefined): number | null {
  if (!teamKey) return null;
  const match = /(?:frc)?(\d{1,5})$/i.exec(teamKey.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function seasonYearFromMatchKey(matchKey: string): number | null {
  const match = /^(\d{4})/.exec(matchKey);
  if (!match) return null;
  const year = Number(match[1]);
  return year > 2000 ? year : null;
}

export type ConfirmedVideoJob = {
  id: string;
  matchKey: string | null;
  createdAt: string;
  result: unknown;
};

/**
 * Confirmed video jobs become timeline rows with provenance. Events without a
 * clock or a match key are skipped — they cannot sit on the timeline honestly.
 */
export function videoJobsToTimelineEntries(jobs: ConfirmedVideoJob[]): MatchNoteEntry[] {
  const entries: MatchNoteEntry[] = [];
  for (const job of jobs) {
    const matchKey = job.matchKey?.trim() || null;
    if (!matchKey) continue;
    const seasonYear = seasonYearFromMatchKey(matchKey);
    if (seasonYear == null) continue;
    const result = job.result;
    if (!result || typeof result !== "object") continue;
    const events = (result as { events?: unknown }).events;
    if (!Array.isArray(events)) continue;
    events.forEach((raw, index) => {
      if (!raw || typeof raw !== "object") return;
      const event = raw as {
        tSec?: unknown;
        kind?: unknown;
        teamKey?: unknown;
        label?: string;
        confidence?: unknown;
      };
      const tSec = Number(event.tSec);
      if (!Number.isFinite(tSec) || tSec < 0) return;
      const label =
        (typeof event.label === "string" && event.label.trim()) ||
        (typeof event.kind === "string" && event.kind.trim()) ||
        "";
      if (!label) return;
      const confidence = typeof event.confidence === "number" && Number.isFinite(event.confidence)
        ? event.confidence
        : null;
      const confidenceBit =
        confidence == null ? "from video" : `from video (confidence ${confidence.toFixed(1)})`;
      entries.push({
        id: `video:${job.id}:${index}`,
        matchLabel: matchKey,
        matchKey,
        teamNumber: typeof event.teamKey === "string" ? teamNumberFromTeamKey(event.teamKey) : null,
        seasonYear,
        phase: phaseFromMatchClock(tSec),
        category: categoryFromVideoKind(typeof event.kind === "string" ? event.kind : undefined),
        clockSeconds: Math.round(tSec),
        note: `${label} · ${confidenceBit}`,
        createdAt: job.createdAt,
        source: "video",
        confidence,
      });
    });
  }
  return entries;
}

/** Prefer a human note's match label when the same TBA match key already exists. */
export function mergeTimelineEntries(
  human: MatchNoteEntry[],
  video: MatchNoteEntry[],
): MatchNoteEntry[] {
  const labelByKey = new Map<string, string>();
  for (const entry of human) {
    if (entry.matchKey) labelByKey.set(entry.matchKey, entry.matchLabel);
  }
  const remapped = video.map((entry) => ({
    ...entry,
    matchLabel: (entry.matchKey && labelByKey.get(entry.matchKey)) || entry.matchLabel,
  }));
  return [...human, ...remapped];
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
