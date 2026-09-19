import { describe, expect, it } from "vitest";
import {
  MIN_MATCHES_FOR_PICKLIST,
  consistencyScore,
  metricRowFromProfile,
  pickListRowsFromScouting,
  scoutingPicklistWeights,
  reliabilityScore,
} from "./picklist-from-scouting";
import { profilesFromScouting } from "./scouting-profile";
import type { ScoutedMatchRow } from "./scouting-rating";
import { rankByWeightedZScores, type MetricWeight } from "./zscore-picklist";

function rows(teamKey: string, totals: readonly (number | "dead")[], extra: Partial<ScoutedMatchRow> = {}) {
  return totals.map((total, index) =>
    total === "dead"
      ? { teamKey, matchKey: `qm${index}`, disabled: true, ...extra }
      : { teamKey, matchKey: `qm${index}`, teleop: total, ...extra },
  ) as ScoutedMatchRow[];
}

/** Enough teams for percentiles and field statistics to mean something. */
function field(): ScoutedMatchRow[] {
  const out: ScoutedMatchRow[] = [];
  for (let t = 0; t < 8; t += 1) {
    out.push(...rows(`frc${700 + t}`, [20 + t * 3, 22 + t * 3, 19 + t * 3, 21 + t * 3, 23 + t * 3, 20 + t * 3]));
  }
  return out;
}

const profileFor = (all: ScoutedMatchRow[], teamKey: string) => {
  const found = profilesFromScouting(all).find((profile) => profile.teamKey === teamKey);
  if (!found) throw new Error(`no profile for ${teamKey}`);
  return found;
};

const rank = (all: ScoutedMatchRow[], weights: MetricWeight[]) =>
  rankByWeightedZScores(pickListRowsFromScouting(profilesFromScouting(all)), weights).map(
    (row) => row.teamKey,
  );

describe("turning lower-is-better into a slider you can push right", () => {
  it("scores a metronome at one and chaos near zero", () => {
    expect(consistencyScore(0)).toBe(1);
    expect(consistencyScore(1)).toBe(0.5);
    expect(consistencyScore(9)).toBeCloseTo(0.1, 5);
    // Always a good: more is better, which is what a positive weight means.
    expect(consistencyScore(0.2)!).toBeGreaterThan(consistencyScore(0.8)!);
  });

  it("scores reliability as the share of matches finished", () => {
    expect(reliabilityScore(0)).toBe(1);
    expect(reliabilityScore(0.25)).toBe(0.75);
    expect(reliabilityScore(1)).toBe(0);
    expect(reliabilityScore(0.4)!).toBeGreaterThan(reliabilityScore(0.7)!);
  });

  it("says nothing rather than zero when the input is missing", () => {
    // "We have not measured this" and "this is bad" are different facts, and a
    // zero fill makes an unmeasured robot look like the worst one.
    expect(consistencyScore(null)).toBeNull();
    expect(consistencyScore(undefined)).toBeNull();
    expect(consistencyScore(Number.NaN)).toBeNull();
    expect(reliabilityScore(null)).toBeNull();
    expect(reliabilityScore(Number.NaN)).toBeNull();
  });

  it("clamps a disabled rate that should not be outside 0–1", () => {
    expect(reliabilityScore(1.4)).toBe(0);
    expect(reliabilityScore(-0.2)).toBe(1);
  });
});

describe("what a profile contributes to a ranking", () => {
  it("carries the shrunk total, not the raw mean", () => {
    // Three good matches must not outrank a season of solid ones — the whole
    // reason shrinkage exists. Ranking the raw average would undo it.
    const all = [...field(), ...rows("frcHOT", [70, 72, 68, 71, 69, 70])];
    const profile = profileFor(all, "frcHOT");
    const row = metricRowFromProfile(profile);
    expect(row.values.totalPoints).toBe(profile.shrunkTotal);
    expect(row.values.totalPoints).not.toBe(profile.meanTotal);
  });

  it("leaves a robot nobody has watched enough with nothing to rank on", () => {
    const all = [...field(), ...rows("frcNEW", [60, 62])];
    const row = metricRowFromProfile(profileFor(all, "frcNEW"));
    expect(Object.keys(row.values)).toHaveLength(0);
    expect(MIN_MATCHES_FOR_PICKLIST).toBeGreaterThan(2);
  });

  it("keeps that robot on the list anyway", () => {
    // "Nobody has watched 4414 yet" is a thing a pick-list meeting needs to
    // see. Dropping the row hides it.
    const all = [...field(), ...rows("frcNEW", [60, 62])];
    const keys = pickListRowsFromScouting(profilesFromScouting(all)).map((row) => row.teamKey);
    expect(keys).toContain("frcNEW");
  });

  it("does not claim a robot plays defense when it never has", () => {
    const all = [...field(), ...rows("frcNODEF", [30, 31, 29, 30, 31, 30])];
    expect(metricRowFromProfile(profileFor(all, "frcNODEF")).values.defenseEffectiveness).toBeNull();
  });
});

describe("the order a team actually gets", () => {
  it("prefers the steadier robot when consistency is what you asked for", () => {
    const all = [
      ...field(),
      ...rows("frcSTEADY", [40, 41, 39, 40, 41, 39]),
      ...rows("frcSWINGY", [8, 72, 9, 71, 10, 70]),
    ];
    // Same average, opposite character.
    const steady = profileFor(all, "frcSTEADY");
    const swingy = profileFor(all, "frcSWINGY");
    expect(Math.abs(steady.meanTotal - swingy.meanTotal)).toBeLessThan(2);

    const order = rank(all, [
      { id: "totalPoints", weight: 1 },
      { id: "consistency", weight: 2 },
    ]);
    expect(order.indexOf("frcSTEADY")).toBeLessThan(order.indexOf("frcSWINGY"));
  });

  it("prefers the robot that survives when reliability is what you asked for", () => {
    const all = [
      ...field(),
      ...rows("frcSOLID", [38, 39, 37, 38, 39, 38]),
      ...rows("frcFRAGILE", [55, "dead", 57, "dead", 56, "dead"]),
    ];
    const order = rank(all, [
      { id: "totalPoints", weight: 1 },
      { id: "reliability", weight: 3 },
    ]);
    expect(order.indexOf("frcSOLID")).toBeLessThan(order.indexOf("frcFRAGILE"));
  });

  it("still takes the fragile robot when you only asked for points", () => {
    // The sliders have to actually change the answer, or they are decoration.
    //
    // Note how much the fragile robot has to score to win on points alone: a
    // disabled match is a real zero in the total, so "points" already absorbs
    // some of the cost of dying. What the reliability slider adds on top is
    // the *risk* — the difference between a robot you can plan around and one
    // that is 120 or nothing.
    const all = [
      ...field(),
      ...rows("frcSOLID", [38, 39, 37, 38, 39, 38]),
      ...rows("frcFRAGILE", [120, "dead", 124, "dead", 122, "dead"]),
    ];
    const byPoints = rank(all, [{ id: "totalPoints", weight: 1 }]);
    expect(byPoints.indexOf("frcFRAGILE")).toBeLessThan(byPoints.indexOf("frcSOLID"));

    // And the same field flips once the team says it cannot afford a robot
    // that might not show up.
    const byReliability = rank(all, [
      { id: "totalPoints", weight: 1 },
      { id: "reliability", weight: 4 },
    ]);
    expect(byReliability.indexOf("frcSOLID")).toBeLessThan(byReliability.indexOf("frcFRAGILE"));
  });

  it("puts a robot with nothing measured at the bottom, not in the middle", () => {
    const all = [...field(), ...rows("frcNEW", [90, 95])];
    const order = rank(all, [{ id: "totalPoints", weight: 1 }]);
    expect(order[order.length - 1]).toBe("frcNEW");
  });

  it("ranks at an event where no official rating will ever arrive", () => {
    // The off-season case: scouting is the only input that exists, and before
    // this the list had nothing to sort by at all.
    const all = [
      ...field(),
      ...rows("frcBEST", [60, 61, 59, 62, 60, 61]),
      ...rows("frcWORST", [5, 6, 4, 5, 6, 5]),
    ];
    const order = rank(all, scoutingPicklistWeights() as MetricWeight[]);
    expect(order.indexOf("frcBEST")).toBeLessThan(order.indexOf("frcWORST"));
  });
});

describe("the opening weights", () => {
  it("lead with scoring, then character", () => {
    const weights = new Map(scoutingPicklistWeights().map((w) => [w.id, w.weight]));
    expect(weights.get("totalPoints")).toBeGreaterThan(weights.get("consistency")!);
    expect(weights.get("consistency")).toBeGreaterThan(0);
    expect(weights.get("reliability")).toBeGreaterThan(0);
  });

  it("leave defense off, because wanting a defender is a decision", () => {
    const weights = new Map(scoutingPicklistWeights().map((w) => [w.id, w.weight]));
    expect(weights.get("defenseEffectiveness")).toBe(0);
  });

  it("name only metrics the ranking knows about", () => {
    // A weight for a metric id nobody populates is a slider that does nothing.
    const rowKeys = new Set(
      Object.keys(metricRowFromProfile(profileFor([...field(), ...rows("frcX", [30, 31, 29, 30, 31, 30])], "frcX")).values),
    );
    for (const { id } of scoutingPicklistWeights()) {
      expect(rowKeys.has(id as string), `${String(id)} is weighted but never filled`).toBe(true);
    }
  });
});
