import { describe, expect, it } from "vitest";
import {
  CONFIDENT_MATCHES,
  MIN_MATCHES_TO_STAND_ALONE,
  canStandAlone,
  implausibleScoutRows,
  ratingsByTeam,
  ratingsFromScouting,
  type ScoutedMatchRow,
} from "./scouting-rating";

function row(over: Partial<ScoutedMatchRow> & { teamKey: string; matchKey: string }): ScoutedMatchRow {
  return { auto: 0, teleop: 0, endgame: 0, ...over };
}

/**
 * A field wide enough for shrinkage to have something to regress toward, with
 * real spread both between teams and match to match. A field of identical
 * teams makes the variance estimate degenerate and is not what an event looks
 * like.
 */
function field(perTeam: number, teams = 12): ScoutedMatchRow[] {
  const rows: ScoutedMatchRow[] = [];
  for (let t = 0; t < teams; t += 1) {
    const teamLevel = 10 + t * 4;
    for (let m = 0; m < perTeam; m += 1) {
      // Deterministic wobble so the test does not depend on a seed.
      const wobble = ((t * 7 + m * 13) % 9) - 4;
      rows.push(row({ teamKey: `frc${100 + t}`, matchKey: `qm${m}`, teleop: teamLevel + wobble }));
    }
  }
  return rows;
}

describe("ratingsFromScouting", () => {
  it("rates a team from its own scouted matches", () => {
    const ratings = ratingsFromScouting([
      row({ teamKey: "frc254", matchKey: "qm1", auto: 10, teleop: 30, endgame: 12 }),
      row({ teamKey: "frc254", matchKey: "qm2", auto: 8, teleop: 26, endgame: 12 }),
    ]);

    expect(ratings).toHaveLength(1);
    const rating = ratings[0]!;
    expect(rating.teamKey).toBe("frc254");
    expect(rating.matches).toBe(2);
    expect(rating.meanAuto).toBe(9);
    expect(rating.meanTeleop).toBe(28);
    expect(rating.meanEndgame).toBe(12);
    expect(rating.meanTotal).toBe(49);
  });

  it("leaves out a team nobody scouted rather than calling it zero", () => {
    // A blank form that was opened and saved is not a robot that scored
    // nothing — it is a robot nobody watched.
    const ratings = ratingsFromScouting([
      { teamKey: "frc111", matchKey: "qm1", auto: null, teleop: null, endgame: null },
      row({ teamKey: "frc254", matchKey: "qm1", teleop: 30 }),
    ]);

    expect(ratings.map((r) => r.teamKey)).toEqual(["frc254"]);
  });

  it("counts a disabled robot as a real zero", () => {
    // Breaking down is one of the most useful things scouting knows, and it
    // belongs in the expected contribution rather than being dropped.
    const ratings = ratingsFromScouting([
      row({ teamKey: "frc9", matchKey: "qm1", teleop: 40 }),
      { teamKey: "frc9", matchKey: "qm2", disabled: true },
    ]);

    const rating = ratings[0]!;
    expect(rating.matches).toBe(2);
    expect(rating.meanTotal).toBe(20);
    expect(rating.disabledRate).toBe(0.5);
    expect(rating.sampleNote).toContain("dead on the field");
  });

  it("does not let one robot be scouted twice for the same match", () => {
    // Two scouts on the same robot, or the same tablet syncing twice.
    const ratings = ratingsFromScouting([
      row({ teamKey: "frc7", matchKey: "qm4", teleop: 30 }),
      row({ teamKey: "frc7", matchKey: "qm4", teleop: 30 }),
      row({ teamKey: "frc7", matchKey: "qm5", teleop: 10 }),
    ]);

    expect(ratings[0]!.matches).toBe(2);
    expect(ratings[0]!.meanTotal).toBe(20);
  });

  it("reports a climb rate only over matches where somebody recorded it", () => {
    const ratings = ratingsFromScouting([
      row({ teamKey: "frc5", matchKey: "qm1", teleop: 10, climbed: true }),
      row({ teamKey: "frc5", matchKey: "qm2", teleop: 10, climbed: false }),
      // Nobody ticked the climb box here; it must not read as a failed climb.
      row({ teamKey: "frc5", matchKey: "qm3", teleop: 10 }),
    ]);

    expect(ratings[0]!.climbRate).toBe(0.5);
  });

  it("returns no climb rate at all when nobody ever recorded one", () => {
    const ratings = ratingsFromScouting([row({ teamKey: "frc5", matchKey: "qm1", teleop: 10 })]);
    expect(ratings[0]!.climbRate).toBeNull();
  });

  it("pulls a one-match number a long way and a ten-match number barely at all", () => {
    // The Friday-morning rookie: one match, drew a strong alliance, now leads
    // the event. Every pick list built off that number is wrong.
    const rows = [
      ...field(10),
      row({ teamKey: "frcNEW", matchKey: "qm1", teleop: 150 }),
    ];
    const byTeam = ratingsByTeam(ratingsFromScouting(rows));

    const rookie = byTeam.get("frcNEW")!;
    const established = byTeam.get("frc111")!;

    expect(rookie.meanTotal).toBe(150);
    expect(rookie.matches).toBe(1);
    expect(established.matches).toBe(10);

    const rookiePull = Math.abs(rookie.shrunkTotal - rookie.meanTotal);
    const establishedPull = Math.abs(established.shrunkTotal - established.meanTotal);

    // Both get pulled; what matters is that evidence buys you your own number.
    expect(rookie.shrunkTotal).toBeLessThan(rookie.meanTotal);
    expect(rookiePull).toBeGreaterThan(establishedPull * 4);
  });

  it("grades confidence by how much was actually watched", () => {
    const one = ratingsFromScouting([row({ teamKey: "frc1", matchKey: "qm1", teleop: 5 })]);
    expect(one[0]!.confidence).toBe("low");

    const few = ratingsFromScouting(
      Array.from({ length: MIN_MATCHES_TO_STAND_ALONE }, (_, i) =>
        row({ teamKey: "frc2", matchKey: `qm${i}`, teleop: 5 }),
      ),
    );
    expect(few[0]!.confidence).toBe("medium");

    const many = ratingsFromScouting(
      Array.from({ length: CONFIDENT_MATCHES }, (_, i) =>
        row({ teamKey: "frc3", matchKey: `qm${i}`, teleop: 5 }),
      ),
    );
    expect(many[0]!.confidence).toBe("high");
  });

  it("ranks the strongest team first", () => {
    const ratings = ratingsFromScouting([
      ...field(6),
      row({ teamKey: "frcTOP", matchKey: "qm1", teleop: 60 }),
      row({ teamKey: "frcTOP", matchKey: "qm2", teleop: 60 }),
      row({ teamKey: "frcTOP", matchKey: "qm3", teleop: 60 }),
      row({ teamKey: "frcTOP", matchKey: "qm4", teleop: 60 }),
      row({ teamKey: "frcTOP", matchKey: "qm5", teleop: 60 }),
      row({ teamKey: "frcTOP", matchKey: "qm6", teleop: 60 }),
    ]);
    expect(ratings[0]!.teamKey).toBe("frcTOP");
  });

  it("is empty for no input rather than throwing", () => {
    expect(ratingsFromScouting([])).toEqual([]);
  });
});

describe("canStandAlone", () => {
  it("refuses to carry a prediction on one or two matches", () => {
    const [thin] = ratingsFromScouting([
      row({ teamKey: "frc1", matchKey: "qm1", teleop: 10 }),
      row({ teamKey: "frc1", matchKey: "qm2", teleop: 10 }),
    ]);
    expect(thin!.matches).toBe(2);
    expect(canStandAlone(thin)).toBe(false);
  });

  it("carries one from three matches up", () => {
    const [enough] = ratingsFromScouting(
      Array.from({ length: MIN_MATCHES_TO_STAND_ALONE }, (_, i) =>
        row({ teamKey: "frc1", matchKey: `qm${i}`, teleop: 10 }),
      ),
    );
    expect(canStandAlone(enough)).toBe(true);
  });

  it("is false for nothing", () => {
    expect(canStandAlone(null)).toBe(false);
    expect(canStandAlone(undefined)).toBe(false);
  });
});

describe("the spread a prediction needs", () => {
  it("measures how much a robot swings, so a band is not a guess", () => {
    // `TeamScoreFeatures.matchSd` existed and nothing filled it, so every
    // alliance band came from the assumed 30% dispersion. A metronome and a
    // boom-or-bust robot produced identical confidence.
    const steady = ratingsFromScouting(
      [30, 31, 29, 30, 31, 29, 30, 31].map((teleop, index) => ({
        teamKey: "frcSTEADY",
        matchKey: `qm${index}`,
        teleop,
      })),
    )[0]!;
    const swingy = ratingsFromScouting(
      [5, 55, 6, 54, 4, 56, 7, 53].map((teleop, index) => ({
        teamKey: "frcSWINGY",
        matchKey: `qm${index}`,
        teleop,
      })),
    )[0]!;

    expect(steady.matchSd).not.toBeNull();
    expect(swingy.matchSd).not.toBeNull();
    expect(swingy.matchSd!).toBeGreaterThan(steady.matchSd! * 5);
    // Same average, so nothing else about them would have told the two apart.
    expect(Math.abs(steady.meanTotal - swingy.meanTotal)).toBeLessThan(2);
  });

  it("says nothing rather than zero when the sample is too thin for a spread", () => {
    // "We cannot tell yet" and "this robot never varies" are different, and a
    // zero would claim certainty about a robot seen three times.
    const thin = ratingsFromScouting(
      [20, 22, 21].map((teleop, index) => ({ teamKey: "frcTHIN", matchKey: `qm${index}`, teleop })),
    )[0]!;
    expect(thin.matchSd).toBeNull();
  });

  it("is zero for a robot that has genuinely scored the same every time", () => {
    const flat = ratingsFromScouting(
      [20, 20, 20, 20, 20, 20].map((teleop, index) => ({
        teamKey: "frcFLAT",
        matchKey: `qm${index}`,
        teleop,
      })),
    )[0]!;
    expect(flat.matchSd).toBe(0);
  });
});

describe("implausibleScoutRows", () => {
  const field = Array.from({ length: 14 }, (_, i) => ({
    teamKey: `frc${100 + (i % 7)}`,
    matchKey: `qm${i + 1}`,
    auto: 6,
    teleop: 14 + (i % 5),
    endgame: 4,
  }));
  it("leaves a typo out of the averages and keeps an elite robot", () => {
    const typo = { teamKey: "frc217", matchKey: "qm20", auto: 8, teleop: 1800, endgame: 10 };
    const elite = { teamKey: "frc254", matchKey: "qm21", auto: 20, teleop: 50, endgame: 12 };
    const rows = [...field, typo, elite];
    expect(implausibleScoutRows(rows)).toEqual([typo]);
    const rated = ratingsFromScouting(rows);
    expect(rated.find((row) => row.teamKey === "frc217")).toBeUndefined();
    expect(rated.find((row) => row.teamKey === "frc254")).toBeDefined();
  });
  it("does not judge a thin field", () => {
    expect(implausibleScoutRows([...field.slice(0, 5), { teamKey: "frc1", matchKey: "x", teleop: 999 }])).toEqual([]);
  });
});
