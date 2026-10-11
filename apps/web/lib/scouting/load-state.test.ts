import { describe, expect, it } from "vitest";
import { classifyScoutLoadFailure, copyAge, loadFailedCopy, retriesByItself, savedCopyBanner } from "./load-state";

const NOW = Date.parse("2026-10-11T20:30:00Z");

describe("classifyScoutLoadFailure", () => {
  it("only says offline when the phone says so", () => {
    expect(classifyScoutLoadFailure({ online: false, status: null, timedOut: false })).toBe("offline");
    expect(classifyScoutLoadFailure({ online: true, status: null, timedOut: true })).toBe("slow");
    expect(classifyScoutLoadFailure({ online: true, status: null, timedOut: false })).toBe("unreachable");
    expect(classifyScoutLoadFailure({ online: true, status: 503, timedOut: false })).toBe("server");
    expect(classifyScoutLoadFailure({ online: true, status: 429, timedOut: false })).toBe("server");
    expect(classifyScoutLoadFailure({ online: true, status: 401, timedOut: false })).toBe("signed-out");
    expect(classifyScoutLoadFailure({ online: true, status: 403, timedOut: false })).toBe("forbidden");
  });

  it("retries by itself only where retrying can work", () => {
    expect(retriesByItself("slow")).toBe(true);
    expect(retriesByItself("server")).toBe(true);
    expect(retriesByItself("signed-out")).toBe(false);
    expect(retriesByItself("forbidden")).toBe(false);
    expect(retriesByItself("offline")).toBe(false);
  });
});

describe("savedCopyBanner", () => {
  it("does not call a slow or failing connection offline", () => {
    for (const failure of ["slow", "unreachable", "server", "signed-out", "forbidden"] as const) {
      expect(savedCopyBanner(failure, null, NOW)).not.toMatch(/offline|No signal/i);
    }
    expect(savedCopyBanner("offline", null, NOW)).toMatch(/^No signal/);
  });

  it("says how old the copy on screen is", () => {
    expect(savedCopyBanner("slow", "2026-10-11T20:27:00Z", NOW)).toBe("Slow connection · showing this phone’s copy from 3 minutes ago while it keeps trying.");
    expect(copyAge("2026-10-11T18:31:00Z", NOW)).toBe(" from 2 hours ago");
    expect(copyAge(null, NOW)).toBe("");
  });

  it("tells a signed-out scout to sign in and a removed one who to ask", () => {
    expect(savedCopyBanner("signed-out", null, NOW)).toMatch(/Sign in again/);
    expect(loadFailedCopy("signed-out").action).toBe("sign-in");
    expect(loadFailedCopy("forbidden")).toEqual({ description: expect.stringMatching(/owner or admin/), action: "none" });
  });
});
