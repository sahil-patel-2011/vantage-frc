import { describe, expect, it } from "vitest";
import { emptyStateBadgeTone, statusBadgeClass } from "./empty-state";

describe("status badge tone", () => {
  it("shows a failure in the error tone, never the setup beige", () => {
    for (const words of ["Unavailable", "Couldn't load", "Could not refresh", "Run failed", "Offline", "Not found"]) {
      expect(emptyStateBadgeTone(words, "setup")).toBe("error");
      expect(statusBadgeClass(words)).toBe("app-badge error");
    }
  });

  it("leaves setup and other tones alone", () => {
    expect(emptyStateBadgeTone("Needs setup", "setup")).toBe("setup");
    expect(emptyStateBadgeTone("Empty", "")).toBe("");
    expect(emptyStateBadgeTone("Ready", "good")).toBe("good");
    expect(statusBadgeClass("Needs setup")).toBe("app-badge setup");
  });
});
