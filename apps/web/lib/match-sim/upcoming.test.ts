import { describe, expect, it } from "vitest";
import type { ScheduleMatch } from "../schedule-board";
import { eventKeyOfMatch, upcomingMatchPicks } from "./upcoming";

function match(n: number, over: Partial<ScheduleMatch> = {}): ScheduleMatch {
  return {
    matchKey: `2026casj_qm${n}`,
    compLevel: "qm",
    matchNumber: n,
    scheduledTime: null,
    red: [`frc${n}1`, `frc${n}2`, `frc${n}3`],
    blue: [`frc${n}4`, `frc${n}5`, `frc${n}6`],
    redScore: null,
    blueScore: null,
    winningAlliance: null,
    scoutCount: 0,
    ...over,
  };
}

describe("upcomingMatchPicks", () => {
  it("lists the next unplayed matches in field order, skipping played ones", () => {
    const picks = upcomingMatchPicks(
      [match(3), match(1, { redScore: 50, blueScore: 40 }), match(2), match(4)],
      null,
      2,
    );
    expect(picks.map((pick) => pick.label)).toEqual(["Q2", "Q3"]);
  });

  it("orders quals before playoffs and playoffs by set", () => {
    const sf2 = match(1, { matchKey: "2026casj_sf2m1", compLevel: "sf", setNumber: 2 });
    const sf1 = match(1, { matchKey: "2026casj_sf1m1", compLevel: "sf", setNumber: 1 });
    const picks = upcomingMatchPicks([sf2, sf1, match(40)], null, 5);
    expect(picks.map((pick) => pick.label)).toEqual(["Q40", "SF1-1", "SF2-1"]);
  });

  it("adds the team's own next match when it is further out than the list", () => {
    const ours = match(9, { blue: ["frc6925", "frc2", "frc3"] });
    const picks = upcomingMatchPicks([match(1), match(2), match(3), ours], "frc6925", 2);
    expect(picks.map((pick) => pick.label)).toEqual(["Q1", "Q2", "Q9"]);
    expect(picks[2]?.ours).toBe("blue");
    expect(picks[0]?.ours).toBeNull();
  });

  it("carries the schedule's win estimate and never invents one", () => {
    const withOdds = match(1, { prediction: { redPredicted: 80, bluePredicted: 70, redWinPct: 0.62, blueWinPct: 0.38 } });
    const [a, b] = upcomingMatchPicks([withOdds, match(2)], null);
    expect(a?.redWinPct).toBe(0.62);
    expect(b?.redWinPct).toBeNull();
  });

  it("drops unscored matches whose time is long past, keeps ones just started or untimed", () => {
    const now = new Date("2026-03-14T15:00:00Z");
    const picks = upcomingMatchPicks(
      [
        match(1, { scheduledTime: "2026-03-14T13:00:00Z" }),
        match(2, { scheduledTime: "2026-03-14T14:50:00Z" }),
        match(3),
      ],
      null,
      6,
      now,
    );
    expect(picks.map((pick) => pick.label)).toEqual(["Q2", "Q3"]);
  });

  it("skips matches whose alliances are not published yet", () => {
    expect(upcomingMatchPicks([match(1, { red: [], blue: [] })], null)).toEqual([]);
  });
});

describe("eventKeyOfMatch", () => {
  it("splits the event from a match key", () => {
    expect(eventKeyOfMatch("2026casj_qm12")).toBe("2026casj");
    expect(eventKeyOfMatch("nounderscore")).toBeNull();
  });
});
