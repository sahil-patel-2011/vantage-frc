import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  errorBandForScoringLevel,
  isScorePredictionSkip,
  predictAllianceScores,
  type TeamScoreFeatures,
} from "../src/calibrated-score";
import { eventOpr, type AllianceResult } from "../src/event-opr";

/*
  The numbers in calibrated-score.ts's comments, checked against real matches.

  Every played match at 2025gagai and 2026gagr is predicted from the robots' event OPR over the
  matches before it — what Home knows walking into that match — then compared with what happened.
  If a change to the model makes these worse, this fails, and the comment it rests on is wrong.
*/

type Played = { event: string; red: string[]; blue: string[]; redScore: number; blueScore: number; redFouls: number; blueFouls: number };

const MATCHES: Played[] = readFileSync(join(__dirname, "fixtures/gagai-gagr-played-matches.csv"), "utf8")
  .split("\n")
  .filter((line) => line.trim() && !line.startsWith("#"))
  .map((line) => {
    const [event, , red, blue, redScore, blueScore, redFouls, blueFouls] = line.split(",");
    const teams = (value: string) => value.split(" ").map((number) => `frc${number}`);
    return { event: event!, red: teams(red!), blue: teams(blue!), redScore: +redScore!, blueScore: +blueScore!, redFouls: +redFouls!, blueFouls: +blueFouls! };
  });

function replay() {
  const out: { redPredicted: number; bluePredicted: number; redWin: number; played: Played; errorBand: number }[] = [];
  for (const event of [...new Set(MATCHES.map((match) => match.event))]) {
    const history: AllianceResult[] = [];
    MATCHES.filter((match) => match.event === event).forEach((match, index) => {
      // After the first six matches, so most robots have played once.
      if (history.length >= 12) {
        const opr = new Map(eventOpr(history, { decay: 1, minMatches: 1 }).map((row) => [row.teamKey, row.total]));
        const level = history.reduce((sum, row) => sum + row.total, 0) / history.length;
        const robots = (side: string[]): TeamScoreFeatures[] =>
          side.map((teamKey) => ({ teamKey, autoEpa: null, teleopEpa: null, endgameEpa: null, opr: opr.get(teamKey) ?? null }));
        const prediction = predictAllianceScores({ matchKey: `${event}_${index}`, red: robots(match.red), blue: robots(match.blue) }, { scoringLevel: level });
        if (!isScorePredictionSkip(prediction)) {
          out.push({ redPredicted: prediction.redPredicted, bluePredicted: prediction.bluePredicted, redWin: prediction.redWinProbability, played: match, errorBand: prediction.errorBand });
        }
      }
      history.push({ matchKey: `${event}_${index}r`, order: index, teamKeys: match.red, total: Math.max(0, match.redScore - match.redFouls) });
      history.push({ matchKey: `${event}_${index}b`, order: index, teamKeys: match.blue, total: Math.max(0, match.blueScore - match.blueFouls) });
    });
  }
  return out;
}

describe("predictions replayed on real matches (2025gagai, 2026gagr)", () => {
  const results = replay();
  const decided = results.filter((row) => row.played.redScore !== row.played.blueScore);

  it("predicts nearly every match once robots have played", () => {
    expect(MATCHES).toHaveLength(153);
    expect(results.length).toBeGreaterThanOrEqual(135);
  });

  it("lands within about 40 points of an alliance's real score, on average", () => {
    const mae = results.reduce((sum, row) => sum + Math.abs(row.redPredicted - row.played.redScore) + Math.abs(row.bluePredicted - row.played.blueScore), 0) / (results.length * 2);
    expect(mae).toBeLessThan(41);
  });

  it("picks the winner about four times in five", () => {
    const right = decided.filter((row) => (row.redPredicted > row.bluePredicted) === (row.played.redScore > row.played.blueScore)).length;
    expect(right / decided.length).toBeGreaterThanOrEqual(0.78);
  });

  it("gives win chances that are honest, not just confident", () => {
    // Brier score: 0.25 is a coin flip every match; the old fixed ±4 scored 0.152 on this set.
    const brier = decided.reduce((sum, row) => sum + (row.redWin - (row.played.redScore > row.played.blueScore ? 1 : 0)) ** 2, 0) / decided.length;
    expect(brier).toBeLessThan(0.147);
  });

  it("shows a ± that scales with the game, not a fixed ±4", () => {
    expect(errorBandForScoringLevel(50)).toBe(22);
    expect(errorBandForScoringLevel(150)).toBe(65);
    expect(errorBandForScoringLevel(null)).toBeUndefined();
    const gagr = results.filter((row) => row.played.event === "2026gagr");
    expect(Math.min(...gagr.map((row) => row.errorBand))).toBeGreaterThan(30);
  });
});

describe("a robot rated only by what it scored at this event", () => {
  const robot = (teamKey: string, opr: number): TeamScoreFeatures => ({ teamKey, autoEpa: null, teleopEpa: null, endgameEpa: null, opr });

  it("counts its whole OPR, and an alliance scores the sum of its three robots", () => {
    const prediction = predictAllianceScores({
      matchKey: "2026gagr_qm60",
      red: [robot("frc1771", 150), robot("frc5074", 5), robot("frc5608", 4)],
      blue: [robot("frc8865", 50), robot("frc8100", 11), robot("frc5109", 60)],
    });
    if (isScorePredictionSkip(prediction)) throw new Error("skipped");
    // It used to be 0.5 × 0.38 × OPR: 159 points of robots predicted as 30.
    expect(prediction.redPredicted).toBe(159);
    expect(prediction.bluePredicted).toBe(121);
    expect(prediction.redWinProbability).toBeGreaterThan(0.6);
  });
});
