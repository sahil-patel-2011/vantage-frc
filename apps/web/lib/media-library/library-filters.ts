/**
 * Pure album/filter logic shared by the client grid and tested in node.
 */

import type { MediaKind, MediaLibraryItem, MediaOrigin } from "./types";

export const NO_ALBUM = "none" as const;

export type MediaFilter = {
  /** Album id, "none" for un-albumed library items, or "all". */
  albumId: string | typeof NO_ALBUM | "all";
  kind: MediaKind | "all";
  eventKey: string | "all";
  subteam: string | "all";
  origin: MediaOrigin | "all";
};

export const EMPTY_FILTER: MediaFilter = {
  albumId: "all",
  kind: "all",
  eventKey: "all",
  subteam: "all",
  origin: "all",
};

export function filterMediaItems(
  items: MediaLibraryItem[],
  filter: Partial<MediaFilter>,
): MediaLibraryItem[] {
  const f: MediaFilter = { ...EMPTY_FILTER, ...filter };
  return items.filter((item) => {
    if (f.albumId !== "all") {
      if (f.albumId === NO_ALBUM) {
        if (item.albumId !== null || item.origin !== "library") return false;
      } else if (item.albumId !== f.albumId) {
        return false;
      }
    }
    if (f.kind !== "all" && item.kind !== f.kind) return false;
    if (f.eventKey !== "all" && item.eventKey !== f.eventKey) return false;
    if (f.subteam !== "all" && item.subteam !== f.subteam) return false;
    if (f.origin !== "all" && item.origin !== f.origin) return false;
    return true;
  });
}

export type MediaFilterOptions = {
  eventKeys: string[];
  subteams: string[];
  origins: MediaOrigin[];
  hasPhotos: boolean;
  hasVideos: boolean;
};

/** Distinct filter choices actually present in the data — never invented. */
export function collectFilterOptions(items: MediaLibraryItem[]): MediaFilterOptions {
  const eventKeys = new Set<string>();
  const subteams = new Set<string>();
  const origins = new Set<MediaOrigin>();
  let hasPhotos = false;
  let hasVideos = false;
  for (const item of items) {
    if (item.eventKey) eventKeys.add(item.eventKey);
    if (item.subteam) subteams.add(item.subteam);
    origins.add(item.origin);
    if (item.kind === "photo") hasPhotos = true;
    if (item.kind === "video") hasVideos = true;
  }
  return {
    eventKeys: [...eventKeys].sort(),
    subteams: [...subteams].sort((a, b) => a.localeCompare(b)),
    origins: [...origins].sort(),
    hasPhotos,
    hasVideos,
  };
}

/** Item count per album id (library-origin items only). */
export function albumItemCounts(items: MediaLibraryItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.origin !== "library" || !item.albumId) continue;
    counts.set(item.albumId, (counts.get(item.albumId) ?? 0) + 1);
  }
  return counts;
}

export const ORIGIN_LABELS: Record<MediaOrigin, string> = {
  library: "Library upload",
  pit_scouting: "Pit scouting photo",
  business_assets: "Business artwork",
};

export function originLabel(origin: MediaOrigin): string {
  return ORIGIN_LABELS[origin] ?? origin;
}
