import { describe, expect, it } from "vitest";
import { inboxText, inboxWhen } from "./inbox-words";

describe("inbox words", () => {
  it("says old coverage alerts the plain way", () => {
    expect(inboxText("21 scouting rows are uncovered at 2026gacmp: QM 31 · 2481")).toBe(
      "21 robots still need scouting at this event: Qual 31 · 2481",
    );
  });

  it("says when without seconds", () => {
    const now = new Date("2026-09-25T18:00:00");
    expect(inboxWhen("2026-09-25T17:48:00", now)).toBe("12 min ago");
    expect(inboxWhen("2026-09-24T21:52:00", now)).toMatch(/^Yesterday /);
    expect(inboxWhen("2026-09-25T17:48:00", now)).not.toMatch(/:\d\d:\d\d/);
  });
});
