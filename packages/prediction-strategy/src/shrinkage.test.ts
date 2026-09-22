import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHRINKAGE_MATCHES,
  MIN_FIELD_SIZE,
  fieldCentre,
  shrinkRatings,
  shrinkageConstant,
  shrinkageNote,
  type TeamSample,
} from "./shrinkage";

function field(count: number, rating = 40, matches = 20, variance = 100): TeamSample[] {
  return Array.from({ length: count }, (_, i) => ({
    teamKey: `frc${100 + i}`,
    rating,
    matches,
    variance,
  }));
}

describe("fieldCentre", () => {
  it("is null when there is no field", () => {
    expect(fieldCentre([])).toBeNull();
  });

  it("ignores the extremes that this module exists to correct", () => {
    // A plain mean is dragged by exactly the small-sample outliers we are about
    // to pull toward the centre, which would make the correction chase noise.
    const ratings = [38, 39, 40, 41, 42, 43, 44, 45, 46, 400];
    const plain = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const centre = fieldCentre(ratings)!;
    expect(centre).toBeLessThan(plain);
    expect(centre).toBeLessThan(60);
  });

  it("keeps everything when trimming would leave nothing", () => {
    expect(fieldCentre([10, 20])).toBe(15);
  });

  it("skips values that are not numbers", () => {
    expect(fieldCentre([10, Number.NaN, 20])).toBe(15);
  });
});

describe("shrinkageConstant", () => {
  it("states its prior rather than inventing a measurement", () => {
    const constant = shrinkageConstant(
      field(10).map((team) => ({ ...team, variance: null })),
    );
    expect(constant.estimated).toBe(false);
    expect(constant.k).toBe(DEFAULT_SHRINKAGE_MATCHES);
    expect(constant.reason).toMatch(/variance/i);
  });

  it("refuses to imagine a field out of a handful of teams", () => {
    const constant = shrinkageConstant(field(MIN_FIELD_SIZE - 1));
    expect(constant.estimated).toBe(false);
    expect(constant.reason).toMatch(/at least/i);
  });

  it("pulls hard when every difference could be luck", () => {
    // Identical teams with noisy matches: nothing separates them, so an unusual
    // number is almost certainly a fluke.
    const constant = shrinkageConstant(field(24, 40, 6, 400));
    expect(constant.estimated).toBe(true);
    expect(constant.k).toBeGreaterThan(20);
  });

  it("barely pulls when teams genuinely differ", () => {
    // Wide, real spread between teams and quiet individual matches: an unusual
    // number is probably a real robot.
    const teams: TeamSample[] = Array.from({ length: 30 }, (_, i) => ({
      teamKey: `frc${i}`,
      rating: i * 4,
      matches: 30,
      variance: 1,
    }));
    const constant = shrinkageConstant(teams);
    expect(constant.estimated).toBe(true);
    expect(constant.k).toBeLessThan(1);
  });

  it("subtracts sampling noise from the spread it can see", () => {
    // The observed spread between teams is inflated by noise. A version that
    // skips the subtraction concludes teams differ hugely and shrinks nothing —
    // this pins that the subtraction happens.
    const noisy = shrinkageConstant(field(30, 40, 4, 900));
    const quiet = shrinkageConstant(
      Array.from({ length: 30 }, (_, i) => ({
        teamKey: `frc${i}`,
        rating: i,
        matches: 4,
        variance: 1,
      })),
    );
    expect(noisy.k).toBeGreaterThan(quiet.k);
  });

  it("never returns a pull outside anything usable", () => {
    const constant = shrinkageConstant(field(30, 40, 1, 1e9));
    expect(constant.k).toBeGreaterThanOrEqual(0.1);
    expect(constant.k).toBeLessThanOrEqual(200);
  });
});

describe("shrinkRatings", () => {
  const mixed: TeamSample[] = [
    { teamKey: "frc-rookie", rating: 90, matches: 2, variance: 100 },
    ...field(20, 40, 25, 100),
  ];

  it("moves a two-match leader a long way and a settled team barely at all", () => {
    // This is the Friday-morning error the module exists for: a rookie who drew
    // two strong alliances tops the event, and every pick list built that
    // morning is wrong because of it.
    const rows = shrinkRatings(mixed);
    const rookie = rows.find((row) => row.teamKey === "frc-rookie")!;
    const settled = rows.find((row) => row.teamKey === "frc100")!;
    expect(Math.abs(rookie.pull)).toBeGreaterThan(Math.abs(settled.pull));
    expect(rookie.shrunk).toBeLessThan(rookie.raw);
    expect(rookie.ownWeight).toBeLessThan(settled.ownWeight);
  });

  it("never pulls a rating past the field's centre", () => {
    // Shrinkage moves toward the middle. Overshooting it would invert the very
    // ranking it is meant to protect.
    const rows = shrinkRatings(mixed);
    const centre = fieldCentre(mixed.map((team) => team.rating))!;
    for (const row of rows) {
      if (row.raw > centre) expect(row.shrunk).toBeGreaterThanOrEqual(centre);
      else expect(row.shrunk).toBeLessThanOrEqual(centre);
    }
  });

  it("keeps the order of two teams with the same sample", () => {
    const rows = shrinkRatings([
      { teamKey: "a", rating: 60, matches: 10, variance: 100 },
      { teamKey: "b", rating: 50, matches: 10, variance: 100 },
      ...field(10, 40, 10, 100),
    ]);
    const a = rows.find((row) => row.teamKey === "a")!;
    const b = rows.find((row) => row.teamKey === "b")!;
    expect(a.shrunk).toBeGreaterThan(b.shrunk);
  });

  it("leaves everything alone when there is no field to lean on", () => {
    // Shrinking four teams toward their own average only makes them look alike.
    const rows = shrinkRatings(field(4, 40, 3, 100));
    for (const row of rows) {
      expect(row.shrunk).toBe(row.raw);
      expect(row.pull).toBe(0);
    }
  });

  it("leaves a team with no matches untouched rather than inventing one", () => {
    const rows = shrinkRatings([
      { teamKey: "unplayed", rating: 0, matches: 0 },
      ...field(20, 40, 25, 100),
    ]);
    const unplayed = rows.find((row) => row.teamKey === "unplayed")!;
    expect(unplayed.shrunk).toBe(0);
    expect(unplayed.pull).toBe(0);
  });

  it("returns a row for every team it was given, in order", () => {
    const rows = shrinkRatings(mixed);
    expect(rows.map((row) => row.teamKey)).toEqual(mixed.map((team) => team.teamKey));
  });

  it("approaches the team's own number as matches pile up", () => {
    const many = shrinkRatings([
      { teamKey: "x", rating: 90, matches: 500, variance: 100 },
      ...field(20, 40, 25, 100),
    ]).find((row) => row.teamKey === "x")!;
    expect(many.ownWeight).toBeGreaterThan(0.95);
    expect(Math.abs(many.pull)).toBeLessThan(3);
  });
});

describe("shrinkageNote", () => {
  it("stays quiet about a move too small to mention", () => {
    expect(
      shrinkageNote({ teamKey: "a", raw: 40, shrunk: 40.2, pull: 0.2, matches: 30, ownWeight: 0.9 }),
    ).toBeNull();
  });

  it("says which way it moved and why", () => {
    const note = shrinkageNote({
      teamKey: "a",
      raw: 90,
      shrunk: 60,
      pull: -30,
      matches: 2,
      ownWeight: 0.2,
    })!;
    expect(note).toMatch(/down/);
    expect(note).toMatch(/2 matches/);
    expect(note).toMatch(/thin record/i);
  });

  it("says match, not matches, for a single one", () => {
    const note = shrinkageNote({
      teamKey: "a",
      raw: 90,
      shrunk: 60,
      pull: -30,
      matches: 1,
      ownWeight: 0.1,
    })!;
    expect(note).toMatch(/1 match\b/);
  });
});
