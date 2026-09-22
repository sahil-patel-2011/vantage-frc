/**
 * Drive-team briefing from a score prediction. Point deltas are only quoted
 * when the predictor produced them — missing inputs stay as a skip, never a
 * made-up plan.
 */

import { typicalScoreErrorCopy, type AllianceScorePrediction } from "./calibrated-score";

export type MatchPlan = {
  auto: string;
  defend: string;
  climb: string;
  briefing: string;
  pointDeltas: string[];
};

export function matchPlanFromPrediction(
  prediction: AllianceScorePrediction,
  ourAlliance: "red" | "blue" | null,
): MatchPlan {
  const us = ourAlliance === "blue" ? prediction.bluePredicted : prediction.redPredicted;
  const them = ourAlliance === "blue" ? prediction.redPredicted : prediction.bluePredicted;
  const margin = ourAlliance ? Math.round((us - them) * 10) / 10 : null;
  const band = prediction.errorBand;

  /**
   * How uncertain *this* margin is, not how the model does on average.
   *
   * The line below used to tell a drive team a lead was only worth a stretch
   * play if it beat "the typical ±4 error" — a property of the model, printed
   * the same on every card. But a six-point lead between robots everybody has
   * watched all weekend is comfortable, and the identical six points between
   * robots nobody has seen is nothing, and that is the whole question a drive
   * team is asking in the ninety seconds before a match.
   *
   * Two independent alliance totals, so the margin's own spread is
   * √(red² + blue²). Falls back to the model band for a prediction made before
   * per-match confidence existed.
   */
  const marginBand =
    Number.isFinite(prediction.redBand) && Number.isFinite(prediction.blueBand)
      ? Math.max(
          1,
          Math.round(
            Math.sqrt(prediction.redBand * prediction.redBand + prediction.blueBand * prediction.blueBand),
          ),
        )
      : band;
  const ourWinChance =
    ourAlliance == null || !Number.isFinite(prediction.redWinProbability)
      ? null
      : Math.round(
          (ourAlliance === "red" ? prediction.redWinProbability : 1 - prediction.redWinProbability) * 100,
        );
  const auto = prediction.drivers.find((line) => /auto/i.test(line))
    ?? "Run the auto you practised — we do not have an auto edge on this card.";
  const climb = prediction.drivers.find((line) => /climb/i.test(line))
    ?? "Climb if you can finish with 20+ seconds left. No climb rate is on this card.";
  const defend = prediction.drivers.find((line) => /defense/i.test(line))
    ?? "Do not assign a defender unless scouting marked one. Defense without a flag is a guess.";
  const bandCopy = typicalScoreErrorCopy(band);
  const briefing = [
    ourAlliance
      ? `You are ${ourAlliance}. Predicted ${us.toFixed(0)}–${them.toFixed(0)} · ${bandCopy}.`
      : `Predicted red ${prediction.redPredicted.toFixed(0)} / blue ${prediction.bluePredicted.toFixed(0)} · ${bandCopy}. Alliance color is not set.`,
    margin != null
      ? margin >= 0
        ? margin > marginBand
          ? `That is about ${margin} points in your favour and bigger than this match's ±${marginBand} swing — play it safe, do not chase.`
          : `That is about ${margin} points in your favour, inside this match's ±${marginBand} swing — close enough that it is anybody's, so take the reliable cycle.`
        : `You are about ${Math.abs(margin)} points behind — play the consistent cycle, not a miracle.`
      : "Set bumper color before the briefing line can pick a side.",
    ourWinChance != null ? `You win this about ${ourWinChance}% of the time.` : "",
    ...prediction.drivers.slice(0, 3),
  ]
    .filter(Boolean)
    .join(" ");
  const pointDeltas = [
    margin != null ? `Predicted margin ${margin > 0 ? "+" : ""}${margin} · ${bandCopy}` : bandCopy,
    ...prediction.drivers.slice(0, 2),
  ];
  return { auto, defend, climb, briefing, pointDeltas };
}
