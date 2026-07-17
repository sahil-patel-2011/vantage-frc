import { describe, expect, it } from "vitest";
import {
  allianceOf,
  compLevelLabel,
  fmtMatchTime,
  isScored,
  matchesUntil,
  matchResult,
  nextOurMatch,
  ourMatches,
  splitByLevel,
  stripFrc,
  type ScheduleMatch,
} from "./schedule-board";

const US = "frc1678";

function match(overrides: Partial<ScheduleMatch>): ScheduleMatch {
  return {
    matchKey: "2026casd_qm1",
    compLevel: "qm",
    matchNumber: 1,
    scheduledTime: null,
    red: [US, "frc254", "frc973"],
    blue: ["frc118", "frc148", "frc2056"],
    redScore: null,
    blueScore: null,
    winningAlliance: null,
    scoutCount: 0,
    ...overrides,
  };
}

describe("compLevelLabel", () => {
  it("maps known levels and uppercases unknown ones", () => {
    expect(compLevelLabel("qm")).toBe("Qual");
    expect(compLevelLabel("qf")).toBe("QF");
    expect(compLevelLabel("sf")).toBe("SF");
    expect(compLevelLabel("f")).toBe("Final");
    expect(compLevelLabel("ef")).toBe("EF");
  });
});

describe("matchResult", () => {
  it("reports a win from our alliance's perspective", () => {
    expect(matchResult(match({ redScore: 87, blueScore: 43 }), US)).toEqual({ result: "W", us: 87, opp: 43 });
  });

  it("reports a loss when our alliance scores fewer points", () => {
    expect(matchResult(match({ red: ["frc254"], blue: [US], redScore: 90, blueScore: 71 }), US)).toEqual({
      result: "L",
      us: 71,
      opp: 90,
    });
  });

  it("reports a tie on equal scores", () => {
    expect(matchResult(match({ redScore: 55, blueScore: 55 }), US)).toEqual({ result: "T", us: 55, opp: 55 });
  });

  it("returns null when unscored or when the team is absent", () => {
    expect(matchResult(match({}), US)).toBeNull();
    expect(matchResult(match({ redScore: 12 }), US)).toBeNull();
    expect(matchResult(match({ redScore: 12, blueScore: 9 }), "frc9999")).toBeNull();
  });
});

describe("ourMatches", () => {
  it("filters to matches containing the team, preserving order", () => {
    const list = [
      match({ matchKey: "m1", red: ["frc1"], blue: ["frc2"] }),
      match({ matchKey: "m2" }),
      match({ matchKey: "m3", red: ["frc3"], blue: [US] }),
    ];
    expect(ourMatches(list, US).map((entry) => entry.matchKey)).toEqual(["m2", "m3"]);
  });
});

describe("nextOurMatch", () => {
  it("skips scored matches and matches the team is not in", () => {
    const list = [
      match({ matchKey: "m1", redScore: 40, blueScore: 60 }),
      match({ matchKey: "m2", red: ["frc1"], blue: ["frc2"] }),
      match({ matchKey: "m3" }),
    ];
    expect(nextOurMatch(list, US)?.matchKey).toBe("m3");
  });

  it("returns null when every one of our matches is scored", () => {
    const list = [match({ matchKey: "m1", redScore: 10, blueScore: 20 })];
    expect(nextOurMatch(list, US)).toBeNull();
  });

  it("skips stale unscored matches older than six hours but keeps recent and untimed ones", () => {
    const now = Date.parse("2026-03-14T18:00:00Z");
    const stale = match({ matchKey: "m1", scheduledTime: "2026-03-14T10:00:00Z" });
    const recent = match({ matchKey: "m2", scheduledTime: "2026-03-14T13:30:00Z" });
    const untimed = match({ matchKey: "m3" });
    expect(nextOurMatch([stale, recent, untimed], US, now)?.matchKey).toBe("m2");
    expect(nextOurMatch([stale, untimed], US, now)?.matchKey).toBe("m3");
  });
});

describe("matchesUntil", () => {
  it("counts unscored matches strictly before the target, excluding the target", () => {
    const target = match({ matchKey: "m4" });
    const list = [
      match({ matchKey: "m1", redScore: 1, blueScore: 2 }),
      match({ matchKey: "m2" }),
      match({ matchKey: "m3" }),
      target,
      match({ matchKey: "m5" }),
    ];
    expect(matchesUntil(list, target)).toBe(2);
    expect(matchesUntil(list, list[0]!)).toBe(0);
  });
});

describe("splitByLevel", () => {
  it("groups by comp level preserving schedule and first-seen order", () => {
    const list = [
      match({ matchKey: "q1", compLevel: "qm", matchNumber: 1 }),
      match({ matchKey: "q2", compLevel: "qm", matchNumber: 2 }),
      match({ matchKey: "s1", compLevel: "sf", matchNumber: 1 }),
      match({ matchKey: "f1", compLevel: "f", matchNumber: 1 }),
    ];
    const groups = splitByLevel(list);
    expect(groups.map((group) => group.level)).toEqual(["qm", "sf", "f"]);
    expect(groups.map((group) => group.label)).toEqual(["Qual", "SF", "Final"]);
    expect(groups[0]!.matches.map((entry) => entry.matchKey)).toEqual(["q1", "q2"]);
  });
});

describe("fmtMatchTime", () => {
  it("returns empty for null or unparsable input and a short label otherwise", () => {
    expect(fmtMatchTime(null)).toBe("");
    expect(fmtMatchTime("not-a-date")).toBe("");
    const label = fmtMatchTime("2026-03-14T15:30:00Z");
    expect(label.length).toBeGreaterThan(0);
    expect(label).toMatch(/\d/);
  });
});

describe("alliance helpers", () => {
  it("identifies the alliance, scoring state, and stripped team numbers", () => {
    expect(allianceOf(match({}), US)).toBe("red");
    expect(allianceOf(match({}), "frc118")).toBe("blue");
    expect(allianceOf(match({}), "frc9999")).toBeNull();
    expect(isScored(match({ redScore: 3, blueScore: 0 }))).toBe(true);
    expect(isScored(match({ redScore: 3 }))).toBe(false);
    expect(stripFrc("frc1678")).toBe("1678");
    expect(stripFrc("1678")).toBe("1678");
  });
});
