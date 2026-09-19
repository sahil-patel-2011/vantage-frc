import { describe, expect, it } from "vitest";
import {
  isScorePredictionSkip,
  predictAllianceScores,
  type TeamScoreFeatures,
} from "./calibrated-score";
import { ratingsByTeam, ratingsFromScouting, type ScoutedMatchRow } from "./scouting-rating";

/**
 * The event this exists for.
 *
 * An off-season like GRITS, a week-0 scrimmage, the first morning of week 1:
 * Statbotics has no EPA, nobody has played enough matches for an OPR, and the
 * only thing that knows anything about these robots is the team's own tablets.
 *
 * Before this, every one of those matches was skipped with "no rating yet",
 * which meant the hours a team spent scouting bought them nothing on exactly
 * the weekend they had no other source.
 */

/** Twelve robots, scouted across six matches each, with real spread. */
function offseasonScouting(): ScoutedMatchRow[] {
  const rows: ScoutedMatchRow[] = [];
  for (let t = 0; t < 12; t += 1) {
    const level = 8 + t * 3;
    for (let m = 0; m < 6; m += 1) {
      rows.push({
        teamKey: `frc${200 + t}`,
        matchKey: `qm${m}`,
        auto: 2 + (t % 3),
        teleop: level,
        endgame: t % 4 === 0 ? 10 : 0,
        climbed: t % 4 === 0,
      });
    }
  }
  return rows;
}

function noOfficialStats(teamKey: string): TeamScoreFeatures {
  return { teamKey, autoEpa: null, teleopEpa: null, endgameEpa: null };
}

describe("predicting an event with no official numbers", () => {
  const scouted = ratingsByTeam(ratingsFromScouting(offseasonScouting()));

  const withScouting = (teamKey: string): TeamScoreFeatures => ({
    ...noOfficialStats(teamKey),
    scouted: scouted.get(teamKey) ?? null,
  });

  it("still skipped the match before scouting was wired in", () => {
    // The old behaviour, kept as a test so the regression is visible: no
    // official stats and no scouting is genuinely unpredictable.
    const result = predictAllianceScores({
      matchKey: "2026gagri_qm1",
      red: ["frc200", "frc201", "frc202"].map(noOfficialStats),
      blue: ["frc203", "frc204", "frc205"].map(noOfficialStats),
    });

    expect(isScorePredictionSkip(result)).toBe(true);
  });

  it("predicts the match from scouting alone", () => {
    const result = predictAllianceScores({
      matchKey: "2026gagri_qm1",
      red: ["frc200", "frc201", "frc202"].map(withScouting),
      blue: ["frc209", "frc210", "frc211"].map(withScouting),
    });

    expect(isScorePredictionSkip(result)).toBe(false);
    if (isScorePredictionSkip(result)) return;

    expect(result.redPredicted).toBeGreaterThan(0);
    expect(result.bluePredicted).toBeGreaterThan(0);
    // Blue here is the top three scouted robots, so it should be ahead.
    expect(result.bluePredicted).toBeGreaterThan(result.redPredicted);
  });

  it("says on the card that the number came from scouting", () => {
    const result = predictAllianceScores({
      matchKey: "2026gagri_qm1",
      red: ["frc200", "frc201", "frc202"].map(withScouting),
      blue: ["frc209", "frc210", "frc211"].map(withScouting),
    });
    if (isScorePredictionSkip(result)) throw new Error("expected a prediction");

    expect(result.basis).toBe("scouting");
    expect(result.drivers[0]).toContain("from your scouting");
  });

  it("widens the band when the number rests on scouting", () => {
    const official = ["frc200", "frc201", "frc202"].map((teamKey) => ({
      teamKey,
      autoEpa: 5,
      teleopEpa: 25,
      endgameEpa: 8,
    }));
    const officialResult = predictAllianceScores({
      matchKey: "official",
      red: official,
      blue: official,
    });
    const scoutingResult = predictAllianceScores({
      matchKey: "scouting",
      red: ["frc200", "frc201", "frc202"].map(withScouting),
      blue: ["frc209", "frc210", "frc211"].map(withScouting),
    });
    if (isScorePredictionSkip(officialResult) || isScorePredictionSkip(scoutingResult)) {
      throw new Error("expected predictions");
    }

    expect(officialResult.basis).toBe("official");
    expect(scoutingResult.errorBand).toBeGreaterThan(officialResult.errorBand);
  });

  it("refuses when a robot has only been watched once or twice", () => {
    const thin = ratingsByTeam(
      ratingsFromScouting([
        { teamKey: "frc300", matchKey: "qm1", teleop: 30 },
        { teamKey: "frc301", matchKey: "qm1", teleop: 30 },
        { teamKey: "frc302", matchKey: "qm1", teleop: 30 },
      ]),
    );
    const result = predictAllianceScores({
      matchKey: "2026gagri_qm2",
      red: ["frc300", "frc301", "frc302"].map((teamKey) => ({
        ...noOfficialStats(teamKey),
        scouted: thin.get(teamKey) ?? null,
      })),
      blue: ["frc209", "frc210", "frc211"].map(withScouting),
    });

    expect(isScorePredictionSkip(result)).toBe(true);
  });

  it("tells you how much more scouting would unlock the estimate", () => {
    const thin = ratingsByTeam(
      ratingsFromScouting([
        { teamKey: "frc300", matchKey: "qm1", teleop: 30 },
        { teamKey: "frc300", matchKey: "qm2", teleop: 30 },
      ]),
    );
    const result = predictAllianceScores({
      matchKey: "2026gagri_qm3",
      red: ["frc300", "frc301", "frc302"].map((teamKey) => ({
        ...noOfficialStats(teamKey),
        scouted: thin.get(teamKey) ?? null,
      })),
      blue: ["frc209", "frc210", "frc211"].map(withScouting),
    });
    if (!isScorePredictionSkip(result)) throw new Error("expected a skip");

    expect(result.skipReason).toContain("scout 1 more match");
    expect(result.skipReason).not.toContain("frc");
  });

  it("names a robot nobody has scouted at all", () => {
    const result = predictAllianceScores({
      matchKey: "2026gagri_qm4",
      red: ["frc999", "frc998", "frc997"].map(noOfficialStats),
      blue: ["frc209", "frc210", "frc211"].map(withScouting),
    });
    if (!isScorePredictionSkip(result)) throw new Error("expected a skip");

    expect(result.skipReason).toContain("nobody has scouted it yet");
    expect(result.skipReason).toContain("999");
  });
});

describe("scouting sharpening a prediction that already has official numbers", () => {
  const base: TeamScoreFeatures = {
    teamKey: "frc1",
    autoEpa: 6,
    teleopEpa: 30,
    endgameEpa: 10,
  };
  const partners: TeamScoreFeatures[] = [
    { teamKey: "frc2", autoEpa: 6, teleopEpa: 30, endgameEpa: 10 },
    { teamKey: "frc3", autoEpa: 6, teleopEpa: 30, endgameEpa: 10 },
  ];
  const opponents: TeamScoreFeatures[] = [
    { teamKey: "frc4", autoEpa: 6, teleopEpa: 30, endgameEpa: 10 },
    { teamKey: "frc5", autoEpa: 6, teleopEpa: 30, endgameEpa: 10 },
    { teamKey: "frc6", autoEpa: 6, teleopEpa: 30, endgameEpa: 10 },
  ];

  function predictWith(red: TeamScoreFeatures[]): number {
    const result = predictAllianceScores({ matchKey: "m", red, blue: opponents });
    if (isScorePredictionSkip(result)) throw new Error("expected a prediction");
    return result.redPredicted;
  }

  it("marks a robot down when the scouts keep watching it die", () => {
    // EPA is built from final scores, so a breakdown is just a low match
    // mixed in. The people watching know the difference.
    const reliable = predictWith([base, ...partners]);
    const breaks = predictWith([
      {
        ...base,
        scouted: ratingsFromScouting([
          { teamKey: "frc1", matchKey: "qm1", teleop: 30 },
          { teamKey: "frc1", matchKey: "qm2", teleop: 30 },
          { teamKey: "frc1", matchKey: "qm3", disabled: true },
          { teamKey: "frc1", matchKey: "qm4", disabled: true },
        ])[0],
      },
      ...partners,
    ]);

    expect(breaks).toBeLessThan(reliable);
  });

  it("leaves a reliable robot's number alone", () => {
    const reliable = predictWith([base, ...partners]);
    const alsoReliable = predictWith([
      {
        ...base,
        scouted: ratingsFromScouting([
          { teamKey: "frc1", matchKey: "qm1", teleop: 30 },
          { teamKey: "frc1", matchKey: "qm2", teleop: 30 },
          { teamKey: "frc1", matchKey: "qm3", teleop: 30 },
        ])[0],
      },
      ...partners,
    ]);

    expect(alsoReliable).toBe(reliable);
  });

  it("does not let two bad-luck matches erase a team", () => {
    const reliable = predictWith([base, ...partners]);
    const unlucky = predictWith([
      {
        ...base,
        scouted: ratingsFromScouting([
          { teamKey: "frc1", matchKey: "qm1", disabled: true },
          { teamKey: "frc1", matchKey: "qm2", disabled: true },
          { teamKey: "frc1", matchKey: "qm3", disabled: true },
        ])[0],
      },
      ...partners,
    ]);

    // Marked down, but still recognisably the same robot.
    expect(unlucky).toBeLessThan(reliable);
    expect(unlucky).toBeGreaterThan(reliable * 0.7);
  });
});
