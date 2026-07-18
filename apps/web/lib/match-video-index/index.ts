// Pure helper functions for the Match Video Index feature — unit-testable, no I/O.

import type { MatchVideoEntry, MatchVideoGroup, MatchVideoIndexSummary, MatchVideoSource } from "./types";

const SOURCE_LABELS: Record<MatchVideoSource, string> = {
  youtube: "YouTube",
  drive: "Drive",
  twitch: "Twitch",
  local: "Local file",
  other: "Other",
};

export function matchVideoSourceLabel(source: MatchVideoSource): string {
  return SOURCE_LABELS[source] ?? source;
}

/** Detect a likely video source from a URL, defaulting to "other" for unrecognized hosts. */
export function detectSourceFromUrl(url: string): MatchVideoSource {
  const lower = url.toLowerCase();
  if (lower.includes("youtube.com") || lower.includes("youtu.be")) return "youtube";
  if (lower.includes("drive.google.com")) return "drive";
  if (lower.includes("twitch.tv")) return "twitch";
  return "other";
}

/** Groups a flat list of video entries by match key, preserving newest-first ordering within a group. */
export function groupVideosByMatch(entries: MatchVideoEntry[]): MatchVideoGroup[] {
  const groups = new Map<string, MatchVideoGroup>();
  for (const entry of entries) {
    const existing = groups.get(entry.matchKey);
    if (existing) {
      existing.videos.push(entry);
      if (!existing.matchLabel && entry.matchLabel) existing.matchLabel = entry.matchLabel;
      if (!existing.eventKey && entry.eventKey) existing.eventKey = entry.eventKey;
    } else {
      groups.set(entry.matchKey, {
        matchKey: entry.matchKey,
        matchLabel: entry.matchLabel,
        eventKey: entry.eventKey,
        videos: [entry],
      });
    }
  }
  return Array.from(groups.values()).sort((a, b) => a.matchKey.localeCompare(b.matchKey));
}

export function summarizeMatchVideoIndex(entries: MatchVideoEntry[]): MatchVideoIndexSummary {
  const bySourceMap = new Map<MatchVideoSource, number>();
  let latestAddedAt: string | null = null;
  const matchKeys = new Set<string>();

  for (const entry of entries) {
    matchKeys.add(entry.matchKey);
    bySourceMap.set(entry.source, (bySourceMap.get(entry.source) ?? 0) + 1);
    if (!latestAddedAt || entry.createdAt > latestAddedAt) latestAddedAt = entry.createdAt;
  }

  const bySource = Array.from(bySourceMap.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalVideos: entries.length,
    totalMatches: matchKeys.size,
    bySource,
    latestAddedAt,
  };
}

/** Normalizes a raw match-key input (e.g. "2026casj_qm12", "  QM12  ") into a stable lowercase key. */
export function normalizeMatchKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, "_");
}
