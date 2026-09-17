import { describe, expect, it } from "vitest";
import {
  CONSISTENCY_LABEL,
  MIN_FOR_SPREAD,
  comparePick,
  describeDistribution,
  summariseDistribution,
  type Distribution,
} from "./distribution";

/** Ten points a match, every match. */
const METRONOME = [10, 10, 10, 10, 10, 10, 10, 10];
/** Also ten points a match on average, and a completely different robot. */
const COIN_FLIP = [0, 0, 0, 0, 20, 20, 20, 20];

function summarise(values: number[]): Distribution {
  const result = summariseDistribution(values);
  if (!result) throw new Error("expected a distribution");
  return result;
}

describe("summariseDistribution", () => {
  it("tells apart two teams with the same average", () => {
    // This is the whole reason the module exists. Both average ten.
    const steady = summarise(METRONOME);
    const swingy = summarise(COIN_FLIP);
    expect(steady.mean).toBe(swingy.mean);
    expect(steady.consistency).not.toBe(swingy.consistency);
    expect(steady.consistency).toBe("metronome");
    expect(swingy.consistency).toBe("boom-or-bust");
  });

  it("reports a floor and a ceiling, which is what a pick actually needs", () => {
    const swingy = summarise(COIN_FLIP);
    expect(swingy.floor).toBe(0);
    expect(swingy.ceiling).toBe(20);
  });

  it("says nothing at all about a team nobody scouted", () => {
    // A team nobody watched and a team that scored nothing are different facts.
    // Rendering them the same is how a pick list gets built on an absence.
    expect(summariseDistribution([])).toBeNull();
    expect(summariseDistribution([Number.NaN])).toBeNull();
  });

  it("distinguishes a scoreless team from an unscouted one", () => {
    const scoreless = summarise([0, 0, 0, 0, 0, 0]);
    expect(scoreless.n).toBe(6);
    expect(scoreless.median).toBe(0);
    // No median to be relative to, so no dispersion — not a huge one.
    expect(scoreless.dispersion).toBeNull();
    expect(scoreless.consistency).toBe("unknown");
  });

  it("refuses to describe spread from too few matches", () => {
    const thin = summarise([5, 20, 5]);
    expect(thin.n).toBeLessThan(MIN_FOR_SPREAD);
    expect(thin.floor).toBeNull();
    expect(thin.ceiling).toBeNull();
    expect(thin.consistency).toBe("unknown");
    // A centre is still honest at three matches; a quartile is not.
    expect(thin.median).toBe(5);
  });

  it("shrugs off one dead battery instead of calling the team erratic", () => {
    // A single broken match is a reliability problem, tracked separately. A
    // standard deviation would brand this team boom-or-bust; quartiles do not.
    const oneDisaster = summarise([0, 12, 12, 13, 12, 13, 12, 13]);
    expect(oneDisaster.consistency).toBe("metronome");
    expect(oneDisaster.min).toBe(0);
  });

  it("still notices a team that is genuinely erratic", () => {
    const erratic = summarise([2, 30, 4, 28, 3, 26, 5, 31]);
    expect(erratic.consistency).toBe("boom-or-bust");
  });

  it("scales the same way for small and large numbers", () => {
    // Dispersion is relative, so a team scoring 5±1 and one scoring 50±10 read
    // as equally consistent, which is correct.
    const small = summarise([4, 5, 5, 5, 5, 6]);
    const large = summarise([40, 50, 50, 50, 50, 60]);
    expect(small.consistency).toBe(large.consistency);
  });

  it("interpolates percentiles rather than jumping between matches", () => {
    // Nearest-rank quartiles lurch as each new match lands, which looks like the
    // robot changed when only the arithmetic did.
    const seven = summarise([1, 2, 3, 4, 5, 6, 7]);
    expect(seven.floor).toBe(2.5);
    expect(seven.ceiling).toBe(5.5);
  });

  it("orders the summary correctly however the matches arrive", () => {
    const shuffled = summarise([7, 1, 5, 3, 6, 2, 4]);
    const ordered = summarise([1, 2, 3, 4, 5, 6, 7]);
    expect(shuffled).toEqual(ordered);
  });

  it("drops unusable values rather than poisoning the summary", () => {
    const withJunk = summarise([10, Number.NaN, 10, Number.POSITIVE_INFINITY, 10]);
    expect(withJunk.n).toBe(3);
    expect(withJunk.mean).toBe(10);
  });

  it("handles a single match without dividing by anything", () => {
    const one = summarise([14]);
    expect(one.n).toBe(1);
    expect(one.median).toBe(14);
    expect(one.min).toBe(14);
    expect(one.max).toBe(14);
    expect(one.consistency).toBe("unknown");
  });

  it("has a label for every verdict it can reach", () => {
    for (const key of Object.keys(CONSISTENCY_LABEL)) {
      expect(CONSISTENCY_LABEL[key as keyof typeof CONSISTENCY_LABEL].length).toBeGreaterThan(0);
    }
  });
});

describe("describeDistribution", () => {
  it("always says how many matches it is speaking from", () => {
    for (const values of [METRONOME, COIN_FLIP, [1, 2, 3]]) {
      expect(describeDistribution(summarise(values))).toMatch(/\d+ match/);
    }
  });

  it("warns that the average flatters a streaky team", () => {
    const line = describeDistribution(summarise([2, 18, 3, 17, 4, 16, 5, 15]));
    expect(line).toMatch(/average/i);
  });

  it("says plainly that a boom-or-bust average describes no real match", () => {
    expect(describeDistribution(summarise(COIN_FLIP))).toMatch(/no match they actually played/i);
  });

  it("does not pretend to a verdict from three matches", () => {
    expect(describeDistribution(summarise([1, 2, 3]))).toMatch(/too few/i);
  });

  it("says match, not matches, for a single one", () => {
    expect(describeDistribution(summarise([9]))).toMatch(/1 match\b/);
  });
});

describe("comparePick", () => {
  const steady = { teamKey: "frc111", distribution: summarise(METRONOME) };
  const swingy = { teamKey: "frc222", distribution: summarise(COIN_FLIP) };

  it("picks the reliable team when you need a floor", () => {
    const result = comparePick(steady, swingy, "floor");
    expect(result.preferred).toBe("frc111");
    expect(result.reason).toMatch(/bad day/);
  });

  it("picks the swingy team when you need a ceiling", () => {
    const result = comparePick(steady, swingy, "ceiling");
    expect(result.preferred).toBe("frc222");
    expect(result.reason).toMatch(/good day/);
  });

  it("refuses to choose between two teams that are the same", () => {
    // Naming a winner on a hair's difference is false precision, and somebody
    // will act on it.
    const a = { teamKey: "frc1", distribution: summarise([10, 10, 10, 10, 10, 10]) };
    const b = { teamKey: "frc2", distribution: summarise([10, 10, 10, 10, 10, 10.1]) };
    expect(comparePick(a, b, "floor").preferred).toBeNull();
    expect(comparePick(a, b, "floor").reason).toMatch(/too close/i);
  });

  it("refuses to compare when one team is barely scouted", () => {
    const thin = { teamKey: "frc333", distribution: summarise([30, 30]) };
    const result = comparePick(steady, thin, "ceiling");
    expect(result.preferred).toBeNull();
    expect(result.reason).toMatch(/too few matches/i);
  });

  it("gives the same answer whichever order the teams arrive in", () => {
    expect(comparePick(steady, swingy, "floor").preferred).toBe(
      comparePick(swingy, steady, "floor").preferred,
    );
    expect(comparePick(steady, swingy, "ceiling").preferred).toBe(
      comparePick(swingy, steady, "ceiling").preferred,
    );
  });

  it("names the gap in points, not as a ratio nobody can act on", () => {
    expect(comparePick(steady, swingy, "floor").reason).toMatch(/worth \d/);
  });
});
