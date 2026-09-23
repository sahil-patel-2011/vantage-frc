import { describe, expect, it } from "vitest";
import { summarizeMirror } from "./mirror-status";

const now = new Date("2026-09-23T12:00:00Z");
const copy = (over: Partial<Parameters<typeof summarizeMirror>[0][number]> & { copy: "excel" | "google" }) => ({
  connected: true,
  lastSyncAt: "2026-09-23T11:00:00Z",
  lastSyncHash: "h1",
  throttledUntil: null,
  lastError: null,
  ...over,
});

describe("summarizeMirror", () => {
  it("calls two copies with one hash identical", () => {
    const summary = summarizeMirror([copy({ copy: "excel" }), copy({ copy: "google" })], now);
    expect(summary.identical).toBe(true);
    expect(summary.headline).toBe("Both copies are identical.");
    expect(summary.copies.map((entry) => entry.health)).toEqual(["in_sync", "in_sync"]);
  });

  it("says which copy is behind when the hashes differ", () => {
    const summary = summarizeMirror(
      [copy({ copy: "excel", lastSyncHash: "old", lastSyncAt: "2026-09-22T11:00:00Z" }), copy({ copy: "google", lastSyncHash: "new" })],
      now,
    );
    expect(summary.identical).toBe(false);
    expect(summary.copies[0]!.health).toBe("behind");
    expect(summary.copies[1]!.health).toBe("in_sync");
  });

  it("explains a resting copy and a signed-out copy", () => {
    const summary = summarizeMirror(
      [
        copy({ copy: "excel", throttledUntil: "2026-09-23T12:20:00Z" }),
        copy({ copy: "google", lastError: "Google sign-in expired or was revoked. An owner or admin needs to reconnect Google Sheets." }),
      ],
      now,
    );
    expect(summary.copies.map((entry) => entry.health)).toEqual(["resting", "attention"]);
  });

  it("asks for the second copy when only one is connected", () => {
    const summary = summarizeMirror([copy({ copy: "excel" }), copy({ copy: "google", connected: false })], now);
    expect(summary.connected).toBe(1);
    expect(summary.headline).toMatch(/Connect the other/);
  });
});
