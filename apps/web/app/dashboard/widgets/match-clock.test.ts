import { describe, expect, it } from "vitest";
import { matchClock } from "./live-countdown";

describe("matchClock", () => {
  const at = Date.parse("2026-09-25T19:07:00Z");

  it("counts down to a match still ahead", () => {
    expect(matchClock(new Date(at).toISOString(), at - 20 * 60_000)).toEqual({ label: "Starts in", value: expect.any(String) });
  });

  it("says a match more than two minutes past its time is running late", () => {
    const clock = matchClock(new Date(at).toISOString(), at + 55 * 60_000);
    expect(clock.value).toBe("Running late");
    expect(clock.label).toMatch(/^Scheduled /);
  });

  it("has no clock without a posted time", () => {
    expect(matchClock(null).value).toBe("Time not posted");
  });
});
