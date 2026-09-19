import { describe, expect, it } from "vitest";
import {
  MIN_MATCHES_FOR_TREND,
  pickListOrder,
  profilesFromScouting,
  type ScoutedTeamProfile,
} from "./scouting-profile";
import type { ScoutedMatchRow } from "./scouting-rating";

function rows(teamKey: string, totals: readonly (number | "dead")[]): ScoutedMatchRow[] {
  return totals.map((total, index) =>
    total === "dead"
      ? { teamKey, matchKey: `qm${index}`, disabled: true }
      : { teamKey, matchKey: `qm${index}`, teleop: total },
  );
}

/** A field with enough teams and spread for shrinkage and percentiles to work. */
function field(): ScoutedMatchRow[] {
  const out: ScoutedMatchRow[] = [];
  for (let t = 0; t < 10; t += 1) {
    out.push(...rows(`frc${500 + t}`, [10 + t * 4, 12 + t * 4, 8 + t * 4, 11 + t * 4, 9 + t * 4, 13 + t * 4]));
  }
  return out;
}

function byTeam(profiles: ScoutedTeamProfile[], teamKey: string): ScoutedTeamProfile {
  const found = profiles.find((profile) => profile.teamKey === teamKey);
  if (!found) throw new Error(`no profile for ${teamKey}`);
  return found;
}

describe("consistency", () => {
  it("separates the robot that does the same thing every match from the one that does not", () => {
    // Same mean (30), completely different robots to pick.
    const profiles = profilesFromScouting([
      ...field(),
      ...rows("frcSTEADY", [29, 30, 31, 30, 29, 31]),
      ...rows("frcSWINGY", [5, 55, 6, 54, 4, 56]),
    ]);

    const steady = byTeam(profiles, "frcSTEADY");
    const swingy = byTeam(profiles, "frcSWINGY");

    expect(steady.meanTotal).toBeCloseTo(swingy.meanTotal, 0);
    expect(steady.consistency.label).toBe("steady");
    expect(swingy.consistency.label).toBe("swingy");
    expect(swingy.consistency.stdDev).toBeGreaterThan(steady.consistency.stdDev * 5);
  });

  it("measures spread against the robot's own output, not in bare points", () => {
    // Five points of swing means opposite things at these two scales.
    const profiles = profilesFromScouting([
      ...field(),
      ...rows("frcSMALL", [5, 10, 5, 10, 5, 10]),
      ...rows("frcBIG", [95, 100, 95, 100, 95, 100]),
    ]);
    expect(byTeam(profiles, "frcSMALL").consistency.label).not.toBe("steady");
    expect(byTeam(profiles, "frcBIG").consistency.label).toBe("steady");
  });

  it("calls a robot that never scores consistent rather than dividing by zero", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frcZERO", [0, 0, 0, 0, 0, 0])]);
    const zero = byTeam(profiles, "frcZERO");
    expect(Number.isFinite(zero.consistency.spreadRatio)).toBe(true);
    expect(zero.consistency.label).toBe("steady");
  });
});

describe("trend", () => {
  it("notices a robot that got better during the event", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frcRISING", [10, 11, 12, 30, 32, 31])]);
    const rising = byTeam(profiles, "frcRISING");
    expect(rising.trend?.direction).toBe("up");
    expect(rising.trend?.delta).toBeGreaterThan(15);
    expect(rising.headline).toContain("more per match");
  });

  it("notices one that fell off", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frcFADING", [40, 38, 41, 12, 10, 11])]);
    expect(byTeam(profiles, "frcFADING").trend?.direction).toBe("down");
  });

  it("calls a point of drift flat rather than a trend", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frcFLAT", [20, 21, 20, 21, 20, 21])]);
    expect(byTeam(profiles, "frcFLAT").trend?.direction).toBe("flat");
  });

  it("draws no trend line through too few matches", () => {
    const thin = MIN_MATCHES_FOR_TREND - 1;
    const profiles = profilesFromScouting([
      ...field(),
      ...rows("frcTHIN", Array.from({ length: thin }, () => 20)),
    ]);
    expect(byTeam(profiles, "frcTHIN").trend).toBeNull();
  });
});

describe("percentile", () => {
  it("places a team against the field rather than reporting a bare number", () => {
    const profiles = profilesFromScouting(field());
    const best = profiles[0]!;
    const worst = profiles[profiles.length - 1]!;
    expect(best.percentile).toBeGreaterThan(worst.percentile!);
    expect(best.percentile).toBeLessThanOrEqual(100);
    expect(worst.percentile).toBeGreaterThanOrEqual(0);
  });

  it("gives identical teams the same percentile instead of picking one", () => {
    const profiles = profilesFromScouting([
      ...rows("frcA", [20, 20, 20, 20, 20, 20]),
      ...rows("frcB", [20, 20, 20, 20, 20, 20]),
      ...rows("frcC", [40, 40, 40, 40, 40, 40]),
    ]);
    expect(byTeam(profiles, "frcA").percentile).toBe(byTeam(profiles, "frcB").percentile);
  });

  it("refuses a percentile when there is no field to compare against", () => {
    const profiles = profilesFromScouting(rows("frcONLY", [20, 20, 20]));
    expect(byTeam(profiles, "frcONLY").percentile).toBeNull();
  });
});

describe("headline", () => {
  it("leads with breaking down when that is the thing to know", () => {
    const profiles = profilesFromScouting([
      ...field(),
      ...rows("frcBREAKS", [40, "dead", 42, "dead", 41, 39]),
    ]);
    expect(byTeam(profiles, "frcBREAKS").headline).toContain("dead on the field");
  });

  it("says how much more scouting a thin team needs", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frcNEW", [50])]);
    const headline = byTeam(profiles, "frcNEW").headline;
    expect(headline).toContain("1 match scouted");
    expect(headline).toContain("2 more");
  });

  it("names the team by number, never by the frc key", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frc254", [30, 30, 30, 30, 30, 30])]);
    const headline = byTeam(profiles, "frc254").headline;
    expect(headline.startsWith("254")).toBe(true);
    expect(headline).not.toContain("frc254");
  });
});

describe("pickListOrder", () => {
  it("leaves out robots nobody has watched enough to rank", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frcNEW", [90, 90])]);
    expect(pickListOrder(profiles).some((profile) => profile.teamKey === "frcNEW")).toBe(false);
  });

  it("puts a steady robot above a swingier one that averages the same", () => {
    const profiles = profilesFromScouting([
      ...field(),
      ...rows("frcSTEADY", [30, 30, 30, 30, 30, 30]),
      ...rows("frcSWINGY", [2, 58, 3, 57, 4, 56]),
    ]);
    const order = pickListOrder(profiles).map((profile) => profile.teamKey);
    expect(order.indexOf("frcSTEADY")).toBeLessThan(order.indexOf("frcSWINGY"));
  });

  it("marks down a robot that keeps dying, without erasing it", () => {
    const profiles = profilesFromScouting([
      ...field(),
      ...rows("frcRELIABLE", [30, 30, 30, 30, 30, 30]),
      ...rows("frcFRAGILE", [40, 40, "dead", 40, "dead", 40]),
    ]);
    const order = pickListOrder(profiles).map((profile) => profile.teamKey);
    expect(order).toContain("frcFRAGILE");
    expect(order.indexOf("frcRELIABLE")).toBeLessThan(order.indexOf("frcFRAGILE"));
  });

  it("is empty rather than throwing when nothing is rankable", () => {
    expect(pickListOrder(profilesFromScouting(rows("frcONE", [10])))).toEqual([]);
    expect(pickListOrder([])).toEqual([]);
  });
});

describe("series", () => {
  it("keeps match order for a sparkline, with dead matches as zero", () => {
    const profiles = profilesFromScouting([...field(), ...rows("frcS", [10, "dead", 30])]);
    expect(byTeam(profiles, "frcS").series).toEqual([10, 0, 30]);
  });

  it("counts one robot once per match even when two scouts filed it", () => {
    const profiles = profilesFromScouting([
      ...field(),
      { teamKey: "frcD", matchKey: "qm1", teleop: 20 },
      { teamKey: "frcD", matchKey: "qm1", teleop: 20 },
      { teamKey: "frcD", matchKey: "qm2", teleop: 10 },
    ]);
    expect(byTeam(profiles, "frcD").series).toEqual([20, 10]);
  });
});
