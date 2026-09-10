import { describe, expect, it } from "vitest";
import { HIDDEN_POLL_FLOOR_MS, visibilityPollDelay } from "./visibility-poll";

describe("visibilityPollDelay", () => {
  it("keeps the visible interval unchanged", () => {
    expect(visibilityPollDelay(20_000, false)).toBe(20_000);
    expect(visibilityPollDelay(30_000, false)).toBe(30_000);
  });

  it("backs off to at least two minutes when the tab is hidden", () => {
    expect(visibilityPollDelay(20_000, true)).toBe(HIDDEN_POLL_FLOOR_MS);
    expect(visibilityPollDelay(45_000, true)).toBe(180_000);
  });
});
