import { errorBandForScoringLevel } from "@vantage/prediction-strategy";
import { describe, expect, it } from "vitest";
import {
  featuresForAlliance,
  isNextMatchScoreSkip,
  nextMatchScoreCard,
  seasonYearFromEventKey,
} from "./score-from-metrics";

describe("seasonYearFromEventKey", () => {
  it("reads the year prefix from a TBA event key", () => {
    expect(seasonYearFromEventKey("2025nvlv")).toBe(2025);
    expect(seasonYearFromEventKey("2019cmpmi")).toBe(2019);
    expect(seasonYearFromEventKey("bad")).toBeNull();
    expect(seasonYearFromEventKey(null)).toBeNull();
  });
});

describe("nextMatchScoreCard", () => {
  const rows = [
    { teamKey: "frc254", autoEpa: 12, teleopEpa: 40, endgameEpa: 10 },
    { teamKey: "frc1678", autoEpa: 8, teleopEpa: 35, endgameEpa: 8 },
    { teamKey: "frc6925", autoEpa: 4, teleopEpa: 20, endgameEpa: 6 },
    { teamKey: "frc111", autoEpa: 3, teleopEpa: 18, endgameEpa: 5 },
    { teamKey: "frc222", autoEpa: 2, teleopEpa: 16, endgameEpa: 4 },
    { teamKey: "frc333", autoEpa: 1, teleopEpa: 14, endgameEpa: 3 },
  ];

  it("returns predicted alliance scores and a briefing when six robots have EPA", () => {
    const card = nextMatchScoreCard({
      matchKey: "2025nvlv_qm1",
      ourAlliance: "blue",
      redKeys: ["frc254", "frc1678", "frc111"],
      blueKeys: ["frc6925", "frc222", "frc333"],
      rows,
    });
    expect(isNextMatchScoreSkip(card)).toBe(false);
    if (isNextMatchScoreSkip(card)) return;
    expect(card.redPredicted).toBeGreaterThan(card.bluePredicted);
    // No event level given: the measured share of this match's own predicted scores.
    expect(card.errorBand).toBe(errorBandForScoringLevel((card.redPredicted + card.bluePredicted) / 2));
    expect(card.briefing).toMatch(/blue/i);
    expect(card.drivers.length).toBeGreaterThan(0);
  });

  it("predicts from what the robots scored at this event when nobody has an EPA", () => {
    // Production today: TBA results, no Statbotics. The card used to skip, or count each OPR at 19%.
    const opr = (teamKey: string, value: number) => ({ teamKey, autoEpa: null, teleopEpa: null, endgameEpa: null, opr: value });
    const card = nextMatchScoreCard({
      matchKey: "2026gagr_qm60",
      ourAlliance: "red",
      redKeys: ["frc1771", "frc5074", "frc5608"],
      blueKeys: ["frc8865", "frc8100", "frc5109"],
      rows: [opr("frc1771", 150), opr("frc5074", 5), opr("frc5608", 4), opr("frc8865", 50), opr("frc8100", 11), opr("frc5109", 60)],
      scoringLevel: 140,
    });
    if (isNextMatchScoreSkip(card)) throw new Error(card.skipReason);
    expect(card.redPredicted).toBe(159);
    expect(card.bluePredicted).toBe(121);
    expect(card.errorBand).toBe(errorBandForScoringLevel(140));
    expect(card.redWinProbability).toBeGreaterThan(0.6);
  });

  it("skips when an alliance is missing ratings", () => {
    const card = nextMatchScoreCard({
      matchKey: "2025nvlv_qm2",
      ourAlliance: "red",
      redKeys: ["frc254"],
      blueKeys: ["frc9999"],
      rows: [{ teamKey: "frc254", autoEpa: 10, teleopEpa: 20, endgameEpa: 5 }],
    });
    expect(isNextMatchScoreSkip(card)).toBe(true);
  });

  it("maps only the keys on that alliance", () => {
    const features = featuresForAlliance(["frc254", "frc000"], [
      { teamKey: "frc254", autoEpa: 1, teleopEpa: 2, endgameEpa: 3 },
    ]);
    expect(features).toHaveLength(2);
    expect(features[0]?.autoEpa).toBe(1);
    expect(features[1]?.autoEpa).toBeNull();
  });
});
