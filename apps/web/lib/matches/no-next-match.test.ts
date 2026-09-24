import { describe, expect, it } from "vitest";
import { matchShortLabel, noNextMatchMessage } from "./no-next-match";

describe("why there is no next match", () => {
  it("says the schedule isn't out when there are no matches for us", () => {
    expect(noNextMatchMessage(null)).toMatch(/schedule for this event isn't out yet/);
    expect(noNextMatchMessage({ total: 0, played: 0, last: null })).toMatch(/isn't out yet/);
  });

  it("says every match is played, with the last result", () => {
    expect(
      noNextMatchMessage({ total: 12, played: 12, last: { label: "Qual 72", ours: 138, theirs: 155, won: false } }),
    ).toBe("All 12 of our matches here are played. Last: Qual 72 (L 138–155).");
    expect(noNextMatchMessage({ total: 3, played: 3, last: null })).toBe("All 3 of our matches here are played.");
  });

  it("says a time is missing when matches are left but none is timed", () => {
    expect(noNextMatchMessage({ total: 12, played: 9, last: null })).toMatch(/doesn't have a time posted yet/);
  });

  it("labels matches the way people say them", () => {
    expect(matchShortLabel("qm", 31)).toBe("Qual 31");
    expect(matchShortLabel("sf", 2, 3)).toBe("Semi 3-2");
    expect(matchShortLabel("f", 1, 1)).toBe("Final 1");
  });
});
