/**
 * Drive-team briefing from a score prediction. Point deltas are only quoted
 * when the predictor produced them — missing inputs stay as a skip, never a
 * made-up plan.
 */

import type { AllianceScorePrediction } from "./calibrated-score";

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
  const auto = prediction.drivers.find((line) => /auto/i.test(line))
    ?? "Run the auto you practised — we do not have an auto edge on this card.";
  const climb = prediction.drivers.find((line) => /climb/i.test(line))
    ?? "Climb if you can finish with 20+ seconds left. No climb rate is on this card.";
  const defend = prediction.drivers.find((line) => /defense/i.test(line))
    ?? "Do not assign a defender unless scouting marked one. Defense without a flag is a guess.";
  const briefing = [
    ourAlliance
      ? `You are ${ourAlliance}. Predicted ${us.toFixed(0)}–${them.toFixed(0)} (band ±${band}).`
      : `Predicted red ${prediction.redPredicted.toFixed(0)} / blue ${prediction.bluePredicted.toFixed(0)} (band ±${band}). Alliance color is not set.`,
    margin != null
      ? margin >= 0
        ? `That is about ${margin} points in your favour — only worth a stretch play if it is bigger than the ±${band} band.`
        : `You are about ${Math.abs(margin)} points behind — play the consistent cycle, not a miracle.`
      : "Set bumper color before the briefing line can pick a side.",
    ...prediction.drivers.slice(0, 3),
  ].join(" ");
  const pointDeltas = [
    margin != null ? `Predicted margin ${margin > 0 ? "+" : ""}${margin} (band ±${band})` : `Error band ±${band} points`,
    ...prediction.drivers.slice(0, 2),
  ];
  return { auto, defend, climb, briefing, pointDeltas };
}
