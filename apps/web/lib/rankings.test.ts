import { describe, expect, it } from "vitest";
import {
  epaBarWidth,
  fmtRankTime,
  formatRecord,
  groupPlayoffs,
  ourStanding,
  parsePlayoffLabel,
  sortRanked,
  stripFrc,
  teamNumberFromKey,
  type PlayoffMatch,
  type RankedTeam,
} from "./rankings";

function team(overrides: Partial<RankedTeam>): RankedTeam {
  return {
    teamKey: "frc1678",
    teamNumber: 1678,
    nickname: "Citrus Circuits",
    rank: null,
    record: null,
    epaTotal: null,
    epaAuto: null,
    epaTeleop: null,
    epaEndgame: null,
    source: null,
    ...overrides,
  };
}

function playoff(overrides: Partial<PlayoffMatch>): PlayoffMatch {
  return {
    matchKey: "2026casd_qf1m1",
    compLevel: "qf",
    matchNumber: 1,
    label: "QF 1-1",
    red: ["frc1", "frc2", "frc3"],
    blue: ["frc4", "frc5", "frc6"],
    redScore: null,
    blueScore: null,
    winner: null,
    scheduledTime: null,
    ...overrides,
  };
}

describe("teamNumberFromKey", () => {
  it("parses frc-prefixed keys and bare numbers", () => {
    expect(teamNumberFromKey("frc254")).toBe(254);
    expect(teamNumberFromKey("frc1678")).toBe(1678);
    expect(teamNumberFromKey("254")).toBe(254);
  });

  it("returns 0 for unparseable keys", () => {
    expect(teamNumberFromKey("frcabc")).toBe(0);
    expect(teamNumberFromKey("")).toBe(0);
  });
});

describe("sortRanked", () => {
  it("orders by rank ascending with null ranks last", () => {
    const list = [
      team({ teamKey: "frc3", teamNumber: 3, rank: 3 }),
      team({ teamKey: "frc9", teamNumber: 9, rank: null, epaTotal: 99 }),
      team({ teamKey: "frc1", teamNumber: 1, rank: 1 }),
    ];
    expect(sortRanked(list).map((entry) => entry.teamKey)).toEqual(["frc1", "frc3", "frc9"]);
  });

  it("breaks ties by EPA total descending (nulls last) then team number ascending", () => {
    const list = [
      team({ teamKey: "frc20", teamNumber: 20, rank: null, epaTotal: 20 }),
      team({ teamKey: "frc30", teamNumber: 30, rank: null, epaTotal: 30 }),
      team({ teamKey: "frc7", teamNumber: 7, rank: null, epaTotal: null }),
      team({ teamKey: "frc5", teamNumber: 5, rank: null, epaTotal: null }),
    ];
    expect(sortRanked(list).map((entry) => entry.teamKey)).toEqual(["frc30", "frc20", "frc5", "frc7"]);
  });

  it("returns a new array without mutating the input order", () => {
    const first = team({ teamKey: "frc3", teamNumber: 3, rank: 2 });
    const list = [first, team({ teamKey: "frc4", teamNumber: 4, rank: 1 })];
    const sorted = sortRanked(list);
    expect(sorted).not.toBe(list);
    expect(list[0]).toBe(first);
  });
});

describe("ourStanding", () => {
  it("reports rank, ranked-team count, and percentile for our team", () => {
    const list = [1, 2, 3, 4, 5].map((rank) => team({ teamKey: `frc${rank}`, teamNumber: rank, rank }));
    expect(ourStanding(list, "frc4")).toEqual({ rank: 4, of: 5, percentile: 40 });
  });

  it("returns null when the team is absent or unranked", () => {
    const list = [team({ teamKey: "frc1", rank: 1 }), team({ teamKey: "frc2", rank: null })];
    expect(ourStanding(list, "frc99")).toBeNull();
    expect(ourStanding(list, "frc2")).toBeNull();
  });

  it("computes percentile from ranked teams only", () => {
    const ranked = Array.from({ length: 42 }, (_, index) =>
      team({ teamKey: `frc${index + 1}`, teamNumber: index + 1, rank: index + 1 }),
    );
    const withUnranked = [...ranked, team({ teamKey: "frc900", teamNumber: 900, rank: null })];
    expect(ourStanding(withUnranked, "frc4")).toEqual({ rank: 4, of: 42, percentile: 93 });
    expect(ourStanding(withUnranked, "frc1")?.percentile).toBe(100);
  });
});

describe("parsePlayoffLabel", () => {
  it("labels quarterfinals as QF set-match", () => {
    expect(parsePlayoffLabel("2026casd_qf1m2", "qf", 2)).toBe("QF 1-2");
  });

  it("labels semifinals as SF set-match", () => {
    expect(parsePlayoffLabel("2026casd_sf2m1", "sf", 1)).toBe("SF 2-1");
  });

  it("labels finals by match number only", () => {
    expect(parsePlayoffLabel("2026casd_f1m3", "f", 3)).toBe("Final 3");
  });

  it("falls back to LEVEL matchNumber when the key does not parse", () => {
    expect(parsePlayoffLabel("2026casd_weird", "qf", 5)).toBe("QF 5");
    expect(parsePlayoffLabel("2026casd_ef2m1", "ef", 1)).toBe("EF 2-1");
  });
});

describe("groupPlayoffs", () => {
  it("orders groups qf then sf then f with friendly labels", () => {
    const list = [
      playoff({ matchKey: "2026casd_f1m1", compLevel: "f" }),
      playoff({ matchKey: "2026casd_sf1m1", compLevel: "sf" }),
      playoff({ matchKey: "2026casd_qf1m1", compLevel: "qf" }),
    ];
    const groups = groupPlayoffs(list);
    expect(groups.map((group) => group.level)).toEqual(["qf", "sf", "f"]);
    expect(groups.map((group) => group.label)).toEqual(["Quarterfinals", "Semifinals", "Finals"]);
  });

  it("sorts matches within a level by set then match parsed from the key", () => {
    const list = [
      playoff({ matchKey: "2026casd_qf2m1", compLevel: "qf" }),
      playoff({ matchKey: "2026casd_qf1m2", compLevel: "qf" }),
      playoff({ matchKey: "2026casd_qf1m1", compLevel: "qf" }),
    ];
    const groups = groupPlayoffs(list);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.matches.map((entry) => entry.matchKey)).toEqual([
      "2026casd_qf1m1",
      "2026casd_qf1m2",
      "2026casd_qf2m1",
    ]);
  });

  it("falls back to matchNumber for unparseable keys and puts unknown levels last", () => {
    const list = [
      playoff({ matchKey: "strange_b", compLevel: "qf", matchNumber: 2 }),
      playoff({ matchKey: "strange_a", compLevel: "qf", matchNumber: 1 }),
      playoff({ matchKey: "2026casd_xx1m1", compLevel: "xx" }),
      playoff({ matchKey: "2026casd_f1m1", compLevel: "f" }),
    ];
    const groups = groupPlayoffs(list);
    expect(groups.map((group) => group.level)).toEqual(["qf", "f", "xx"]);
    expect(groups.map((group) => group.label)).toEqual(["Quarterfinals", "Finals", "XX"]);
    expect(groups[0]?.matches.map((entry) => entry.matchKey)).toEqual(["strange_a", "strange_b"]);
  });
});

describe("epaBarWidth", () => {
  it("returns 0 for null EPA or non-positive max", () => {
    expect(epaBarWidth(null, 30)).toBe(0);
    expect(epaBarWidth(10, 0)).toBe(0);
    expect(epaBarWidth(10, -4)).toBe(0);
  });

  it("rounds to an integer percent and clamps to 0-100", () => {
    expect(epaBarWidth(15, 30)).toBe(50);
    expect(epaBarWidth(29.9, 30)).toBe(100);
    expect(epaBarWidth(45, 30)).toBe(100);
    expect(epaBarWidth(-5, 30)).toBe(0);
  });
});

describe("formatRecord", () => {
  it("builds a W-L-T string, zero-filling partial data, and null when empty", () => {
    expect(formatRecord(10, 2, 0)).toBe("10-2-0");
    expect(formatRecord(5, null, null)).toBe("5-0-0");
    expect(formatRecord(null, null, null)).toBeNull();
  });
});

describe("stripFrc", () => {
  it("strips the frc prefix and leaves bare numbers alone", () => {
    expect(stripFrc("frc1678")).toBe("1678");
    expect(stripFrc("1678")).toBe("1678");
  });
});

describe("fmtRankTime", () => {
  it("returns empty for null or unparsable input and a short label otherwise", () => {
    expect(fmtRankTime(null)).toBe("");
    expect(fmtRankTime("not-a-date")).toBe("");
    const label = fmtRankTime("2026-03-14T15:30:00Z");
    expect(label.length).toBeGreaterThan(0);
    expect(label).toMatch(/\d/);
  });
});
