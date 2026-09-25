import { describe, expect, it } from "vitest";
import { matchCard, matchLabel, nextMatchIndex, orderedSchedule, scheduleIsOver, type ScheduleMatch } from "./next-match";

const qual = (n: number, red: number[], blue: number[]): ScheduleMatch => ({
  matchKey: `2027test_qm${n}`,
  matchNumber: n,
  compLevel: "qm",
  redAlliance: { teamKeys: red.map((t) => `frc${t}`) },
  blueAlliance: { teamKeys: blue.map((t) => `frc${t}`) },
});

const schedule = orderedSchedule([
  qual(3, [7, 8, 9], [10, 11, 12]),
  qual(1, [1, 2, 3], [4, 5, 6]),
  qual(2, [13, 14, 15], [16, 17, 18]),
  { matchKey: "2027test_sf1m1", matchNumber: 1, compLevel: "sf" },
]);

describe("next match for a scout", () => {
  it("orders quals before playoffs and labels both", () => {
    expect(schedule.map((m) => m.matchKey)).toEqual(["2027test_qm1", "2027test_qm2", "2027test_qm3", "2027test_sf1m1"]);
    expect(matchLabel(schedule[0]!)).toBe("Qual 1");
    expect(matchLabel(schedule[3]!)).toBe("Semi 1-1");
  });

  it("opens after the latest match the team has scouting for, not at Qual 1", () => {
    expect(nextMatchIndex(schedule, [], [])).toBe(0);
    expect(nextMatchIndex(schedule, [{ matchKey: "2027test_qm2", teamKey: "frc13" }], [])).toBe(2);
  });

  it("with match times, starts at the first match not yet played that still needs a robot", () => {
    const now = Date.parse("2026-09-24T20:00:00Z");
    const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
    const timed = [
      { ...qual(1, [1, 2, 3], [4, 5, 6]), matchTime: at(-60) },
      { ...qual(2, [13, 14, 15], [16, 17, 18]), matchTime: at(10) },
      { ...qual(3, [7, 8, 9], [10, 11, 12]), matchTime: at(30) },
    ];
    // One stray entry on Qual 3 no longer skips Qual 2, which is still to play.
    expect(nextMatchIndex(timed, [{ matchKey: "2027test_qm3", teamKey: "frc7" }], [], now)).toBe(1);
    // Every robot in Qual 2 scouted: on to Qual 3.
    const all2 = [13, 14, 15, 16, 17, 18].map((t) => ({ matchKey: "2027test_qm2", teamKey: `frc${t}` }));
    expect(nextMatchIndex(timed, all2, [], now)).toBe(2);
  });

  it("prefers your next assignment from there on", () => {
    const assignments = [{ matchKey: "2027test_qm1", teamKey: "frc2" }, { matchKey: "2027test_sf1m1", teamKey: "frc9" }];
    // Qual 1 is behind the team's latest scouting (Qual 2), so the next assignment wins.
    expect(nextMatchIndex(schedule, [{ matchKey: "2027test_qm2", teamKey: "frc13" }], assignments)).toBe(3);
  });

  it("lays out six robots red then blue, marking yours and the ones already scouted", () => {
    const card = matchCard(schedule, 0, [{ matchKey: "2027test_qm1", teamKey: "frc4" }], [{ matchKey: "2027test_qm1", teamKey: "frc2" }])!;
    expect(card.label).toBe("Qual 1");
    expect(card.robots.map((r) => `${r.alliance}${r.station}:${r.teamNumber}`)).toEqual([
      "red1:1", "red2:2", "red3:3", "blue1:4", "blue2:5", "blue3:6",
    ]);
    expect(card.robots.find((r) => r.teamNumber === "2")?.assignedToYou).toBe(true);
    expect(card.robots.find((r) => r.teamNumber === "4")?.scouted).toBe(true);
    expect(matchCard(schedule, 99, [], [])).toBeNull();
  });
});

describe("a finished schedule", () => {
  const hour = 60 * 60 * 1000;
  const now = Date.parse("2026-09-24T18:00:00Z");
  const at = (offset: number) => new Date(now + offset).toISOString();
  it("is over only when every match is well past", () => {
    expect(scheduleIsOver([{ matchKey: "a", matchNumber: 1, matchTime: at(-5 * hour) }], now)).toBe(true);
    expect(scheduleIsOver([{ matchKey: "a", matchNumber: 1, matchTime: at(-5 * hour) }, { matchKey: "b", matchNumber: 2, matchTime: at(-hour) }], now)).toBe(false);
    expect(scheduleIsOver([{ matchKey: "a", matchNumber: 1 }], now)).toBe(false);
    expect(scheduleIsOver([], now)).toBe(false);
  });
});
