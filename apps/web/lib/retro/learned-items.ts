// Pure learned-item projection and handoff payloads.
//
// Retro's job is "what we learned" — but only what someone actually wrote on a
// start/stop/continue board. This module never invents a lesson: empty / whitespace
// rows are dropped, and a season with no items produces an empty list (and a null
// playbook body) instead of canned advice.

import type {
  RetroHandoffTarget,
  RetroItemKind,
  RetroLearnedItem,
} from "./types";

function kindLabel(kind: RetroItemKind): string {
  if (kind === "start") return "Start";
  if (kind === "stop") return "Stop";
  return "Continue";
}

export const RETRO_SOURCE_PREFIX = "[source:retro:";
export const RETRO_SOURCE_SUFFIX = "]";

const TITLE_MAX = 200;
const DETAIL_MAX = 4000;

export function retroSourceMarker(itemId: string): string {
  return `${RETRO_SOURCE_PREFIX}${itemId}${RETRO_SOURCE_SUFFIX}`;
}

export function parseRetroSourceId(detail: string | null | undefined): string | null {
  if (!detail) return null;
  const start = detail.lastIndexOf(RETRO_SOURCE_PREFIX);
  if (start < 0) return null;
  const from = start + RETRO_SOURCE_PREFIX.length;
  const end = detail.indexOf(RETRO_SOURCE_SUFFIX, from);
  if (end < 0) return null;
  const id = detail.slice(from, end).trim();
  return id || null;
}

export function playbookSlugForSeason(seasonYear: number): string {
  return `retro-lessons-${seasonYear}`;
}

export function playbookTitleForSeason(seasonYear: number): string {
  return `${seasonYear} retro lessons`;
}

/** Drop blank rows. Sort by votes, then newest. Never fabricates content. */
export function collectLearnedItems(
  rows: Array<Partial<RetroLearnedItem> & { id?: string | null; content?: string | null }>,
): RetroLearnedItem[] {
  const items: RetroLearnedItem[] = [];
  for (const row of rows) {
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const content = typeof row.content === "string" ? row.content.trim() : "";
    if (!id || !content) continue;
    const kind: RetroItemKind =
      row.kind === "start" || row.kind === "stop" || row.kind === "continue" ? row.kind : "continue";
    items.push({
      id,
      sessionId: typeof row.sessionId === "string" ? row.sessionId : "",
      sessionTitle: typeof row.sessionTitle === "string" ? row.sessionTitle.trim() : "",
      kind,
      content,
      authorName: typeof row.authorName === "string" && row.authorName.trim() ? row.authorName.trim() : null,
      voteCount: Number.isFinite(Number(row.voteCount)) ? Math.max(0, Math.floor(Number(row.voteCount))) : 0,
      createdAt: typeof row.createdAt === "string" ? row.createdAt : "",
    });
  }
  return items.sort((a, b) => {
    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

export function filterLearnedItems(
  items: RetroLearnedItem[],
  itemIds?: readonly string[] | null,
): RetroLearnedItem[] {
  if (!itemIds || itemIds.length === 0) return items;
  const wanted = new Set(itemIds.filter((id) => typeof id === "string" && id.trim()));
  return items.filter((item) => wanted.has(item.id));
}

export function parseHandoffTarget(value: unknown): RetroHandoffTarget {
  if (value === "season-report" || value === "playbook" || value === "both") return value;
  return "both";
}

export function learnedItemSentiment(kind: RetroItemKind): "positive" | "negative" {
  return kind === "stop" ? "negative" : "positive";
}

export function learnedItemTitle(item: RetroLearnedItem): string {
  const label = kindLabel(item.kind);
  const title = `${label}: ${item.content}`.trim();
  return title.slice(0, TITLE_MAX);
}

export type SeasonReportLessonDraft = {
  category: "lessons";
  title: string;
  detail: string;
  sentiment: "positive" | "negative";
  sourceItemId: string;
};

/** One season-report lessons entry per real retro item. Empty input → []. */
export function seasonReportLessonDrafts(items: RetroLearnedItem[]): SeasonReportLessonDraft[] {
  return items.map((item) => {
    const session = item.sessionTitle ? `Session: ${item.sessionTitle}` : "Session: (untitled)";
    const author = item.authorName ? `Author: ${item.authorName}` : null;
    const detail = [item.content, session, author, retroSourceMarker(item.id)].filter(Boolean).join("\n");
    return {
      category: "lessons",
      title: learnedItemTitle(item),
      detail: detail.slice(0, DETAIL_MAX),
      sentiment: learnedItemSentiment(item.kind),
      sourceItemId: item.id,
    };
  });
}

/**
 * Playbook markdown built only from the supplied items. Returns null when there
 * is nothing real to write — callers must refuse to insert a page in that case.
 * Empty kind sections are omitted, never filled with a placeholder lesson.
 */
export function buildPlaybookBody(input: { seasonYear: number; items: RetroLearnedItem[] }): string | null {
  const items = collectLearnedItems(input.items);
  if (items.length === 0) return null;

  const lines: string[] = [
    `# ${playbookTitleForSeason(input.seasonYear)}`,
    "",
    "Promoted from real retro sessions. Nothing here was invented.",
    "",
  ];

  for (const kind of ["start", "stop", "continue"] as const) {
    const group = items.filter((item) => item.kind === kind);
    if (group.length === 0) continue;
    lines.push(`## ${kindLabel(kind)}`);
    lines.push("");
    for (const item of group) {
      const session = item.sessionTitle ? ` (${item.sessionTitle})` : "";
      lines.push(`- ${item.content}${session}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function playbookTags(): string[] {
  return ["retro", "lessons", "playbook"];
}
