import { describe, expect, it } from "vitest";
import { isPausedMediaFile, isPausedMediaRoute, MEDIA_ENABLED } from "./media-availability";
import { PRODUCT_HUBS } from "./nav/hubs";
import { canAccessWidget, homeViewLayout } from "./dashboard/catalog";
import { decideStorageRoute } from "./storage-routing/decide";

describe("reversible media pause", () => {
  it("blocks direct pages, nested endpoints and hub aliases", () => {
    expect(MEDIA_ENABLED).toBe(false);
    for (const path of ["/media", "/media-library", "/video-analysis", "/api/media/posts", "/api/scouting/media/test.png", "/api/media-library/items/id"]) {
      expect(isPausedMediaRoute(path)).toBe(true);
    }
    expect(isPausedMediaRoute("/competition", "video")).toBe(true);
    expect(isPausedMediaRoute("/business", "content-drafts")).toBe(true);
    for (const path of ["/dashboard", "/api/scouting/sync", "/api/todos", "/files", "/api/drive"]) {
      expect(isPausedMediaRoute(path)).toBe(false);
    }
    expect(isPausedMediaRoute("/competition", "scouting")).toBe(false);
  });
  it("removes media tabs and pit stream widgets without touching saved data", () => {
    expect(PRODUCT_HUBS.flatMap((hub) => hub.tabs).some((tab) => tab.id === "video" || tab.id === "media-library")).toBe(false);
    expect(canAccessWidget("pit_youtube", "owner")).toBe(false);
    const saved = [{ i: "pit", type: "pit_youtube" as const, x: 0, y: 0, w: 6, h: 4 }];
    expect(homeViewLayout(saved, { editing: true, shell: "ready" })).toEqual([]);
    expect(saved).toHaveLength(1);
  });
  it("rejects media by MIME or extension but permits documents and CAD", () => {
    for (const [name, type] of [["photo.JPG", "application/octet-stream"], ["clip.MOV", ""], ["upload", "image/jpeg"], ["upload", "video/mp4"]]) {
      expect(isPausedMediaFile(name!, type!)).toBe(true);
    }
    expect(isPausedMediaFile("manual.pdf", "application/pdf")).toBe(false);
    expect(isPausedMediaFile("robot.step", "application/octet-stream")).toBe(false);
  });
  it("refuses storage grants even when object storage is configured", () => {
    const base = { byteSize: 100, policy: { nodeThresholdBytes: 1000, preferNodeClasses: [], cloudFallback: true }, node: null, cloudCapBytes: 1000, objectStore: { configured: true as const } };
    expect(decideStorageRoute({ ...base, contentClass: "photo" }).destination).toBe("refused");
    expect(decideStorageRoute({ ...base, contentClass: "video" }).destination).toBe("refused");
    expect(decideStorageRoute({ ...base, contentClass: "document" }).destination).toBe("cloud");
  });
});
