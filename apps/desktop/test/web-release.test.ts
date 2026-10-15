import { describe, expect, it } from "vitest";
import { decideWebReleasePrompt, parseWebRelease, webReleaseDetail, type WebRelease } from "../src/update";

const release: WebRelease = {
  id: "2026-10-15.3",
  headline: "Cleaner menus and pages",
  changes: ["One sidebar and one search", "Delete buttons sit apart and ask first"],
  date: "2026-10-15",
};
const base = {
  loadedId: "2026-10-15.2",
  latest: release,
  now: 1_000,
  currentUrl: "https://vantagefrc.vercel.app/dashboard",
  windowFocused: true,
};

describe("web release prompt", () => {
  it("asks when the web app is serving a newer release than the open page", () => {
    expect(decideWebReleasePrompt(base)).toBe("prompt");
  });

  it("never offers the release the page is already on, or before the first answer", () => {
    expect(decideWebReleasePrompt({ ...base, loadedId: release.id })).toBe("none");
    expect(decideWebReleasePrompt({ ...base, loadedId: null })).toBe("none");
    expect(decideWebReleasePrompt({ ...base, latest: null })).toBe("none");
  });

  it("waits after Later, then asks again", () => {
    expect(decideWebReleasePrompt({ ...base, dismissedId: release.id, dismissedUntil: 5_000 })).toBe("none");
    expect(decideWebReleasePrompt({ ...base, dismissedId: release.id, dismissedUntil: 500 })).toBe("prompt");
    // A newer release than the one put off is asked about straight away.
    expect(decideWebReleasePrompt({ ...base, dismissedId: "older", dismissedUntil: 5_000 })).toBe("prompt");
  });

  it("never interrupts a live match screen someone is looking at", () => {
    const live = "https://vantagefrc.vercel.app/scouting";
    expect(decideWebReleasePrompt({ ...base, currentUrl: live })).toBe("none");
    expect(decideWebReleasePrompt({ ...base, currentUrl: live, windowFocused: false })).toBe("prompt");
    expect(decideWebReleasePrompt({ ...base, windowFocused: false })).toBe("prompt");
  });

  it("reads only a well-formed release, and lists its changes in plain words", () => {
    expect(parseWebRelease({ id: "a", headline: "" })).toBeNull();
    expect(parseWebRelease(null)).toBeNull();
    expect(parseWebRelease({ id: " a ", headline: " Hi ", changes: ["x", 3, " "] })).toEqual({ id: "a", headline: "Hi", changes: ["x"], date: null });
    expect(webReleaseDetail(release)).toBe("• One sidebar and one search\n• Delete buttons sit apart and ask first");
    expect(webReleaseDetail({ ...release, changes: [] })).toBe("Reload to get the latest version.");
  });
});
