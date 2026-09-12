// Pure helper functions for Team Retrospective — no I/O, unit-testable.
// Everything here is derived strictly from the rows callers pass in; nothing is fabricated
// when a session/season has no activity — it is simply absent or zeroed in the result.

import type { RetroActionItem, RetroItem, RetroItemKind, RetroPostmortemCounts } from "./types";

export {
  buildPlaybookBody,
  collectLearnedItems,
  filterLearnedItems,
  parseHandoffTarget,
  playbookSlugForSeason,
  playbookTitleForSeason,
  retroSourceMarker,
  seasonReportLessonDrafts,
} from "./learned-items";
export type { SeasonReportLessonDraft } from "./learned-items";

export const RETRO_ITEM_KINDS: RetroItemKind[] = ["start", "stop", "continue"];

export function retroItemKindLabel(kind: RetroItemKind): string {
  if (kind === "start") return "Start";
  if (kind === "stop") return "Stop";
  return "Continue";
}

/** Highest-voted items first, ties broken by newest. */
export function sortItemsByVotes(items: RetroItem[]): RetroItem[] {
  return [...items].sort((a, b) => {
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function groupItemsByKind(items: RetroItem[]): Record<RetroItemKind, RetroItem[]> {
  const grouped: Record<RetroItemKind, RetroItem[]> = { start: [], stop: [], continue: [] };
  for (const item of items) grouped[item.kind].push(item);
  for (const kind of RETRO_ITEM_KINDS) grouped[kind] = sortItemsByVotes(grouped[kind]);
  return grouped;
}

export function countItemsByKind(items: RetroItem[]): { start: number; stop: number; continue: number } {
  return {
    start: items.filter((i) => i.kind === "start").length,
    stop: items.filter((i) => i.kind === "stop").length,
    continue: items.filter((i) => i.kind === "continue").length,
  };
}

export function countOpenActions(actions: RetroActionItem[]): number {
  return actions.filter((a) => a.status !== "done").length;
}

/** Deterministic narrative synthesized entirely from the counted rows — no external model call. */
export function buildPostmortemNarrative(input: {
  seasonYear: number;
  counts: RetroPostmortemCounts;
}): string {
  const { seasonYear, counts } = input;
  const segments: string[] = [`${seasonYear} season postmortem:`];

  if (counts.decisionsTotal > 0) {
    segments.push(
      `${counts.decisionsTotal} decision(s) logged (${counts.decisionsAccepted} accepted, ${counts.decisionsRejected} rejected)`,
    );
  } else {
    segments.push("no decisions logged");
  }

  if (counts.risksTotal > 0) {
    segments.push(`${counts.risksTotal} risk(s) tracked (${counts.risksOpen} still open, ${counts.risksClosed} closed)`);
  } else {
    segments.push("no risks tracked");
  }

  if (counts.incidentsTotal > 0) {
    const bySeverity = counts.incidentsBySeverity.map((row) => `${row.count} ${row.severity}`).join(", ");
    segments.push(`${counts.incidentsTotal} safety incident(s) (${bySeverity})`);
  } else {
    segments.push("no safety incidents");
  }

  if (counts.fmeaFailuresTotal > 0) {
    segments.push(`${counts.fmeaFailuresTotal} failure(s) logged`);
    if (counts.fmeaTopFailures.length > 0) {
      const top = counts.fmeaTopFailures
        .slice(0, 3)
        .map((f) => `${f.title} (${f.subsystemName}, priority ${f.rpn})`)
        .join("; ");
      segments.push(`top by priority: ${top}`);
    }
  } else {
    segments.push("no failures logged");
  }

  if (counts.retroActionItemsTotal > 0) {
    segments.push(
      `${counts.retroActionItemsTotal} retro action item(s) recorded (${counts.retroActionItemsOpen} still open)`,
    );
  } else {
    segments.push("no retro action items recorded");
  }

  return segments.join(" · ");
}
