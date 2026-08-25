import { describe, expect, it } from "vitest";
import {
  albumItemCounts,
  collectFilterOptions,
  filterMediaItems,
  originLabel,
  NO_ALBUM,
} from "./library-filters";
import type { MediaLibraryItem } from "./types";

let counter = 0;
function item(overrides: Partial<MediaLibraryItem>): MediaLibraryItem {
  counter += 1;
  return {
    id: `item-${counter}`,
    origin: "library",
    kind: "photo",
    title: `Item ${counter}`,
    caption: null,
    albumId: null,
    takenAt: null,
    eventKey: null,
    subteam: null,
    contentType: "image/jpeg",
    byteSize: 1000,
    width: null,
    height: null,
    durationSeconds: null,
    storageLocation: "db",
    status: "ready",
    uploaderId: "u1",
    uploaderName: "Sam",
    canManage: false,
    createdAt: "2026-03-01T00:00:00Z",
    src: "/x",
    thumbnailSrc: null,
    ...overrides,
  };
}

const items = [
  item({ albumId: "a1", eventKey: "2026onosh", subteam: "media" }),
  item({ albumId: "a1", kind: "video", contentType: "video/mp4" }),
  item({ albumId: null }),
  item({ origin: "pit_scouting", eventKey: "2026onosh" }),
  item({ origin: "business_assets" }),
  item({ albumId: "a2", subteam: "mechanical" }),
];

describe("filterMediaItems", () => {
  it("returns everything with the empty filter", () => {
    expect(filterMediaItems(items, {})).toHaveLength(items.length);
  });

  it("filters by album", () => {
    expect(filterMediaItems(items, { albumId: "a1" })).toHaveLength(2);
    expect(filterMediaItems(items, { albumId: "a2" })).toHaveLength(1);
  });

  it("'none' means un-albumed LIBRARY items only — union sources excluded", () => {
    const unfiled = filterMediaItems(items, { albumId: NO_ALBUM });
    expect(unfiled).toHaveLength(1);
    expect(unfiled[0].origin).toBe("library");
    expect(unfiled[0].albumId).toBeNull();
  });

  it("filters by kind, event, subteam, and origin", () => {
    expect(filterMediaItems(items, { kind: "video" })).toHaveLength(1);
    expect(filterMediaItems(items, { eventKey: "2026onosh" })).toHaveLength(2);
    expect(filterMediaItems(items, { subteam: "mechanical" })).toHaveLength(1);
    expect(filterMediaItems(items, { origin: "pit_scouting" })).toHaveLength(1);
    expect(filterMediaItems(items, { origin: "business_assets" })).toHaveLength(1);
  });

  it("combines filters with AND semantics", () => {
    expect(filterMediaItems(items, { albumId: "a1", kind: "photo" })).toHaveLength(1);
    expect(filterMediaItems(items, { eventKey: "2026onosh", origin: "library" })).toHaveLength(1);
    expect(filterMediaItems(items, { albumId: "a2", kind: "video" })).toHaveLength(0);
  });
});

describe("collectFilterOptions", () => {
  it("collects only values that actually exist in the data", () => {
    const options = collectFilterOptions(items);
    expect(options.eventKeys).toEqual(["2026onosh"]);
    expect(options.subteams).toEqual(["mechanical", "media"]);
    expect(options.origins).toEqual(["business_assets", "library", "pit_scouting"]);
    expect(options.hasPhotos).toBe(true);
    expect(options.hasVideos).toBe(true);
  });

  it("returns empty options for an empty library", () => {
    const options = collectFilterOptions([]);
    expect(options.eventKeys).toEqual([]);
    expect(options.subteams).toEqual([]);
    expect(options.origins).toEqual([]);
    expect(options.hasPhotos).toBe(false);
    expect(options.hasVideos).toBe(false);
  });
});

describe("albumItemCounts", () => {
  it("counts library items per album and ignores union sources", () => {
    const counts = albumItemCounts(items);
    expect(counts.get("a1")).toBe(2);
    expect(counts.get("a2")).toBe(1);
    expect([...counts.keys()]).toEqual(["a1", "a2"]);
  });
});

describe("originLabel", () => {
  it("labels every origin", () => {
    expect(originLabel("library")).toBe("Library upload");
    expect(originLabel("pit_scouting")).toBe("Pit scouting photo");
    expect(originLabel("business_assets")).toBe("Business artwork");
  });
});
