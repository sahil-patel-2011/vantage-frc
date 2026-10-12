import { describe, expect, it } from "vitest";
import { isMatchPlayed, matchHasStarted, playedMatchKeys, type PlayStateMatch } from "./play-state";

const qual = (n: number, extra: Partial<PlayStateMatch> = {}): PlayStateMatch => ({
  matchKey: `2026gacmp_qm${n}`,
  matchNumber: n,
  compLevel: "qm",
  ...extra,
});

describe("one definition of played for every scouting screen", () => {
  // The QA event: Quals 1-30 have scores; 31-36 are hours late with no result and no start.
  const event = [
    ...Array.from({ length: 30 }, (_, index) => qual(index + 1, { redScore: 50, blueScore: 40 })),
    ...Array.from({ length: 6 }, (_, index) => qual(index + 31)),
  ];

  it("calls a late match with no result still ahead, however late", () => {
    const played = playedMatchKeys(event);
    expect(played.size).toBe(30);
    expect(played.has("2026gacmp_qm31")).toBe(false);
    expect(isMatchPlayed(event[30]!, event)).toBe(false);
  });

  it("calls a match played once it has a result, a start time, or the field moved past it", () => {
    expect(matchHasStarted(qual(1, { redScore: 0, blueScore: 0 }))).toBe(true);
    expect(matchHasStarted(qual(1, { actualTime: "2026-10-11T14:00:00Z" }))).toBe(true);
    expect(matchHasStarted(qual(1, { postResultTime: "2026-10-11T14:05:00Z" }))).toBe(true);
    expect(matchHasStarted(qual(1, { redScore: 50, blueScore: null }))).toBe(false);
    // Qual 31's result never synced, but Qual 32 started: 31 is over.
    const skipped = [qual(31), qual(32, { actualTime: "2026-10-11T15:00:00Z" }), qual(33)];
    expect(isMatchPlayed(skipped[0]!, skipped)).toBe(true);
    expect(isMatchPlayed(skipped[2]!, skipped)).toBe(false);
    expect([...playedMatchKeys(skipped)].sort()).toEqual(["2026gacmp_qm31", "2026gacmp_qm32"]);
  });

  it("never lets a playoff start close a qualification match, or the reverse", () => {
    const mixed: PlayStateMatch[] = [qual(80), { matchKey: "2026gacmp_sf1m1", matchNumber: 1, compLevel: "sf", actualTime: "2026-10-11T18:00:00Z" }];
    expect(isMatchPlayed(mixed[0]!, mixed)).toBe(false);
    expect(isMatchPlayed({ matchKey: "2026gacmp_f1m3", matchNumber: 3, compLevel: "f" }, mixed)).toBe(false);
  });

  it("agrees with itself one match at a time and in one pass", () => {
    const sample = [qual(1, { winningAlliance: "red" }), qual(2), qual(3, { actualTime: "x" }), qual(4)];
    const fast = playedMatchKeys(sample);
    for (const match of sample) expect(fast.has(match.matchKey)).toBe(isMatchPlayed(match, sample));
  });
});
