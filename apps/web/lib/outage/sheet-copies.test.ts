import { describe, expect, it } from "vitest";
import {
  SHEET_COPIES_KEY,
  bannerLinks,
  copiesFromMirrorStatus,
  readSheetCopies,
  rememberSheetCopies,
  safeCopyUrl,
  shouldRefreshSheetCopies,
} from "./sheet-copies";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    raw: map,
  };
}

const status = {
  copies: [
    { copy: "google", connected: true, fileUrl: "https://docs.google.com/spreadsheets/d/abc/edit", fileName: "Team 1 copy", lastSyncHash: "h" },
    { copy: "excel", connected: true, fileUrl: "https://contoso-my.sharepoint.com/personal/x/book.xlsx", fileName: "Team 1.xlsx" },
    { copy: "excel", connected: false, fileUrl: "https://onedrive.live.com/x" },
  ],
};

describe("spreadsheet copy links for the limited banner", () => {
  it("keeps only connected copies on the provider's own https domain", () => {
    expect(copiesFromMirrorStatus(status)).toEqual([
      { kind: "google", url: "https://docs.google.com/spreadsheets/d/abc/edit", name: "Team 1 copy" },
      { kind: "excel", url: "https://contoso-my.sharepoint.com/personal/x/book.xlsx", name: "Team 1.xlsx" },
    ]);
    expect(safeCopyUrl("google", "http://docs.google.com/x")).toBeNull();
    expect(safeCopyUrl("google", "https://evil.example/docs.google.com")).toBeNull();
    expect(safeCopyUrl("excel", "javascript:alert(1)")).toBeNull();
    expect(copiesFromMirrorStatus({ error: "nope" })).toEqual([]);
  });

  it("remembers links per team (not the sheet data), refreshes twice a day, and lists the current team first", () => {
    const storage = memoryStorage();
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(shouldRefreshSheetCopies(readSheetCopies(storage), "org-a", now)).toBe(true);
    rememberSheetCopies(storage, "org-b", "Team 2", [{ kind: "google", url: "https://docs.google.com/b", name: null }], now);
    const cache = rememberSheetCopies(storage, "org-a", "Team 1", copiesFromMirrorStatus(status), now);
    expect(Object.keys(JSON.parse(storage.raw.get(SHEET_COPIES_KEY)!))).toEqual(["org-a", "org-b"]);
    expect(shouldRefreshSheetCopies(cache, "org-a", now + 60_000)).toBe(false);
    expect(shouldRefreshSheetCopies(cache, "org-a", now + 13 * 60 * 60 * 1000)).toBe(true);
    expect(bannerLinks(cache, "org-b").map((link) => link.team)).toEqual(["Team 2", "Team 1", "Team 1"]);
    expect(bannerLinks(cache, null)).toHaveLength(3);
  });

  it("survives junk in storage", () => {
    const storage = memoryStorage();
    storage.setItem(SHEET_COPIES_KEY, "{not json");
    expect(readSheetCopies(storage)).toEqual({});
    storage.setItem(SHEET_COPIES_KEY, JSON.stringify({ x: { savedAt: "now", copies: [{ kind: "google", url: "http://bad" }] } }));
    expect(readSheetCopies(storage).x!.copies).toEqual([]);
    expect(readSheetCopies(null)).toEqual({});
  });
});
