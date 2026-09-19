import { describe, expect, it } from "vitest";
import {
  ALLIANCE_CORRELATION,
  DEFAULT_MODEL_SD,
  FALLBACK_DISPERSION,
  allianceBelief,
  describeConfidence,
  matchBelief,
  matchSdFromDistribution,
  normalCdf,
  teamVariance,
  type TeamScoreBelief,
} from "./score-uncertainty";
import { summariseDistribution } from "./distribution";

function belief(partial: Partial<TeamScoreBelief> & { teamKey: string }): TeamScoreBelief {
  return {
    mean: partial.mean ?? 30,
    observations: partial.observations ?? 10,
    // `??` here swallowed an intentional `matchSd: null` and handed back 6,
    // so two tests about the no-spread-on-record path silently tested the
    // measured path instead — and passed.
    matchSd: partial.matchSd === undefined ? 6 : partial.matchSd,
    disabledRate: partial.disabledRate ?? 0,
    official: partial.official ?? true,
    teamKey: partial.teamKey,
  };
}

const trio = (over: Partial<TeamScoreBelief> = {}) => [
  belief({ teamKey: "frcA", ...over }),
  belief({ teamKey: "frcB", ...over }),
  belief({ teamKey: "frcC", ...over }),
];

describe("normalCdf", () => {
  it("matches the values everyone knows", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 5);
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 5);
    expect(normalCdf(1.96)).toBeCloseTo(0.9750021, 5);
    expect(normalCdf(-2.58)).toBeCloseTo(0.0049400, 4);
  });

  it("is symmetric and monotone", () => {
    for (const z of [0.1, 0.5, 1, 2, 3, 4]) {
      expect(normalCdf(z) + normalCdf(-z)).toBeCloseTo(1, 6);
    }
    let previous = 0;
    for (let z = -4; z <= 4; z += 0.25) {
      const value = normalCdf(z);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("does not return NaN at the extremes", () => {
    expect(normalCdf(40)).toBeCloseTo(1, 6);
    expect(normalCdf(-40)).toBeCloseTo(0, 6);
    expect(normalCdf(Number.POSITIVE_INFINITY)).toBe(1);
    expect(normalCdf(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("what makes one robot uncertain", () => {
  it("a robot that swings more is less certain, at the same average", () => {
    const steady = teamVariance(belief({ teamKey: "frcS", mean: 40, matchSd: 3 }));
    const swingy = teamVariance(belief({ teamKey: "frcW", mean: 40, matchSd: 18 }));
    expect(swingy.variance).toBeGreaterThan(steady.variance * 5);
    expect(steady.mean).toBe(swingy.mean);
  });

  it("watching a robot more makes its average surer, but never removes its swing", () => {
    const thin = teamVariance(belief({ teamKey: "frcT", observations: 2 }));
    const thick = teamVariance(belief({ teamKey: "frcT", observations: 40 }));
    expect(thin.estimation).toBeGreaterThan(thick.estimation);
    // The robot still varies match to match however long you watch it.
    expect(thick.swing).toBe(thin.swing);
    expect(thick.variance).toBeGreaterThan(thick.swing);
  });

  it("treats a robot nobody has watched as a guess, not as precise", () => {
    const unwatched = teamVariance(belief({ teamKey: "frcU", observations: 0 }));
    const watched = teamVariance(belief({ teamKey: "frcU", observations: 12 }));
    expect(unwatched.variance).toBeGreaterThan(watched.variance);
    // Estimation error as large as the swing itself, not zero and not infinite.
    expect(unwatched.estimation).toBe(unwatched.swing);
  });

  it("makes an unreliable strong robot far riskier than an unreliable weak one", () => {
    // The whole reason reliability is a variance term and not a flat penalty.
    const strong = teamVariance(belief({ teamKey: "frcBig", mean: 60, disabledRate: 0.25 }));
    const weak = teamVariance(belief({ teamKey: "frcSmall", mean: 8, disabledRate: 0.25 }));
    expect(strong.reliability).toBeGreaterThan(weak.reliability * 20);
  });

  it("adds nothing for a robot that has never died", () => {
    expect(teamVariance(belief({ teamKey: "frcOk", disabledRate: 0 })).reliability).toBe(0);
  });

  it("peaks at a coin-flip robot, because that is the least predictable one", () => {
    // d(1-d) is maximised at 0.5: a robot that always dies is as predictable
    // as one that never does — you just plan for nothing.
    const always = teamVariance(belief({ teamKey: "frcX", mean: 50, disabledRate: 1 }));
    const half = teamVariance(belief({ teamKey: "frcX", mean: 50, disabledRate: 0.5 }));
    const rarely = teamVariance(belief({ teamKey: "frcX", mean: 50, disabledRate: 0.1 }));
    expect(half.reliability).toBeGreaterThan(rarely.reliability);
    expect(half.reliability).toBeGreaterThan(always.reliability);
    expect(always.reliability).toBe(0);
  });

  it("falls back to a stated assumption when no spread is on record, and says so", () => {
    const guessed = teamVariance(belief({ teamKey: "frcG", mean: 50, matchSd: null }));
    expect(guessed.measuredSpread).toBe(false);
    expect(Math.sqrt(guessed.swing)).toBeCloseTo(FALLBACK_DISPERSION * 50, 5);

    const measured = teamVariance(belief({ teamKey: "frcG", mean: 50, matchSd: 5 }));
    expect(measured.measuredSpread).toBe(true);
  });

  it("does not call a zero-scoring robot a certainty", () => {
    // FALLBACK_DISPERSION * 0 is 0, which would claim we know exactly what a
    // robot nobody has seen score will do.
    const zero = teamVariance(belief({ teamKey: "frcZ", mean: 0, matchSd: null }));
    expect(zero.variance).toBeGreaterThan(0);
  });

  it("survives inputs that are not numbers", () => {
    const broken = teamVariance({
      teamKey: "frcNaN",
      mean: Number.NaN,
      observations: -5,
      matchSd: Number.NaN,
      official: false,
    });
    expect(Number.isFinite(broken.variance)).toBe(true);
    expect(broken.variance).toBeGreaterThan(0);
  });
});

describe("combining an alliance", () => {
  it("is wider than the sum of its parts, because robots share a field", () => {
    const beliefs = trio();
    const combined = allianceBelief(90, beliefs, { modelSd: 0 });
    const independentSd = Math.sqrt(
      beliefs.map(teamVariance).reduce((total, team) => total + team.variance, 0),
    );
    expect(combined.sd).toBeGreaterThan(independentSd);
    expect(ALLIANCE_CORRELATION).toBeGreaterThan(0);
  });

  it("takes the mean it is given rather than summing one of its own", () => {
    // The score model applies its own interaction discount; a second one here
    // would quietly shrink every prediction.
    expect(allianceBelief(77, trio()).mean).toBe(77);
  });

  it("includes the model's own residual error", () => {
    const withModel = allianceBelief(90, trio(), { modelSd: 10 });
    const without = allianceBelief(90, trio(), { modelSd: 0 });
    expect(withModel.sd).toBeGreaterThan(without.sd);
    expect(allianceBelief(90, trio()).sd).toBeGreaterThan(without.sd);
    expect(DEFAULT_MODEL_SD).toBeGreaterThan(0);
  });

  it("reports each robot's share, so a screen can say which one is the doubt", () => {
    const beliefs = [
      belief({ teamKey: "frcSteady", matchSd: 2 }),
      belief({ teamKey: "frcWild", matchSd: 20 }),
      belief({ teamKey: "frcSteady2", matchSd: 2 }),
    ];
    const combined = allianceBelief(90, beliefs);
    const wild = combined.teams.find((team) => team.teamKey === "frcWild")!;
    const steady = combined.teams.find((team) => team.teamKey === "frcSteady")!;
    expect(wild.variance).toBeGreaterThan(steady.variance * 10);
  });

  it("handles an empty alliance without producing NaN", () => {
    const empty = allianceBelief(0, []);
    expect(Number.isFinite(empty.sd)).toBe(true);
    expect(empty.sd).toBeCloseTo(DEFAULT_MODEL_SD, 6);
  });
});

describe("the match", () => {
  it("is a coin flip when the two alliances are identical", () => {
    const match = matchBelief({ mean: 90, beliefs: trio() }, { mean: 90, beliefs: trio() });
    expect(match.redWinProbability).toBeCloseTo(0.5, 6);
    expect(match.marginMean).toBe(0);
  });

  it("gets surer as the gap grows", () => {
    const close = matchBelief({ mean: 92, beliefs: trio() }, { mean: 90, beliefs: trio() });
    const clear = matchBelief({ mean: 130, beliefs: trio() }, { mean: 90, beliefs: trio() });
    expect(clear.redWinProbability).toBeGreaterThan(close.redWinProbability);
    expect(close.redWinProbability).toBeGreaterThan(0.5);
  });

  it("is less sure about the same gap when the robots are wilder", () => {
    // The point of the whole file: identical point predictions, different
    // confidence, because one set of robots is known and the other is not.
    const known = matchBelief(
      { mean: 110, beliefs: trio({ matchSd: 3, observations: 30 }) },
      { mean: 90, beliefs: trio({ matchSd: 3, observations: 30 }) },
    );
    const unknown = matchBelief(
      { mean: 110, beliefs: trio({ matchSd: 25, observations: 2 }) },
      { mean: 90, beliefs: trio({ matchSd: 25, observations: 2 }) },
    );
    expect(known.marginMean).toBe(unknown.marginMean);
    expect(known.redWinProbability).toBeGreaterThan(unknown.redWinProbability + 0.15);
    expect(unknown.redBand).toBeGreaterThan(known.redBand * 2);
  });

  it("never claims certainty, however lopsided", () => {
    const blowout = matchBelief(
      { mean: 400, beliefs: trio({ matchSd: 1, observations: 60 }) },
      { mean: 10, beliefs: trio({ matchSd: 1, observations: 60 }) },
    );
    expect(blowout.redWinProbability).toBeLessThanOrEqual(0.98);
    expect(blowout.redWinProbability).toBeGreaterThan(0.9);

    const reverse = matchBelief(
      { mean: 10, beliefs: trio({ matchSd: 1, observations: 60 }) },
      { mean: 400, beliefs: trio({ matchSd: 1, observations: 60 }) },
    );
    expect(reverse.redWinProbability).toBeGreaterThanOrEqual(0.02);
  });

  it("gives bands of at least a point", () => {
    const match = matchBelief(
      { mean: 50, beliefs: trio({ matchSd: 0, observations: 99 }) },
      { mean: 50, beliefs: trio({ matchSd: 0, observations: 99 }) },
      { modelSd: 0 },
    );
    expect(match.redBand).toBeGreaterThanOrEqual(1);
    expect(match.blueBand).toBeGreaterThanOrEqual(1);
  });

  it("red and blue probabilities are two sides of one number", () => {
    const match = matchBelief(
      { mean: 120, beliefs: trio() },
      { mean: 95, beliefs: trio({ matchSd: 12 }) },
    );
    expect(match.redWinProbability).toBeGreaterThan(0.5);
    expect(1 - match.redWinProbability).toBeLessThan(0.5);
  });
});

describe("matchSdFromDistribution", () => {
  it("uses the same spread the pick list calls streaky", () => {
    const steady = summariseDistribution([30, 31, 29, 30, 31, 29]);
    const wild = summariseDistribution([5, 55, 6, 54, 4, 56]);
    const steadySd = matchSdFromDistribution(steady)!;
    const wildSd = matchSdFromDistribution(wild)!;
    expect(wildSd).toBeGreaterThan(steadySd * 5);
  });

  it("returns null rather than zero when the sample is too thin for a spread", () => {
    // Three matches has no IQR in distribution.ts — and "no spread known" and
    // "no spread" must not look the same to the caller.
    expect(matchSdFromDistribution(summariseDistribution([20, 22, 21]))).toBeNull();
    expect(matchSdFromDistribution(null)).toBeNull();
  });

  it("is zero for a robot that has genuinely scored the same every time", () => {
    expect(matchSdFromDistribution(summariseDistribution([20, 20, 20, 20, 20, 20]))).toBe(0);
  });
});

describe("saying it out loud", () => {
  it("names the robot that is breaking, because that is the story", () => {
    const line = describeConfidence(
      matchBelief(
        {
          mean: 120,
          beliefs: [
            belief({ teamKey: "frc6925", mean: 60, disabledRate: 0.4 }),
            belief({ teamKey: "frcB" }),
            belief({ teamKey: "frcC" }),
          ],
        },
        { mean: 100, beliefs: trio() },
      ),
    );
    expect(line).toContain("6925");
    expect(line).toContain("dying on the field");
    expect(line).not.toContain("frc6925");
  });

  it("says when the doubt is simply that nobody has watched them", () => {
    const line = describeConfidence(
      matchBelief(
        { mean: 100, beliefs: trio({ matchSd: null, observations: 1 }) },
        { mean: 95, beliefs: trio({ matchSd: null, observations: 1 }) },
      ),
    );
    expect(line).toContain("barely been watched");
  });

  it("names the favourite and a percentage a student can read", () => {
    const line = describeConfidence(
      matchBelief({ mean: 130, beliefs: trio() }, { mean: 90, beliefs: trio() }),
    );
    expect(line).toMatch(/^Red by about 40, \d+% likely/);

    const blue = describeConfidence(
      matchBelief({ mean: 90, beliefs: trio() }, { mean: 130, beliefs: trio() }),
    );
    expect(blue).toMatch(/^Blue by about 40, \d+% likely/);
  });
});
