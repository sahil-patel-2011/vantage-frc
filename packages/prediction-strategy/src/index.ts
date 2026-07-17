export type {
  Alliance,
  MatchPrediction,
  MatchPredictionInput,
  PredictionFactor,
  TeamOperationalSignal,
  TeamSeasonSignal,
} from "./types";
export * from "./signals";

import type {
  Alliance,
  MatchPrediction,
  MatchPredictionInput,
  PredictionFactor,
  TeamOperationalSignal,
  TeamSeasonSignal,
} from "./types";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

export function seasonWeight(currentYear: number, year: number) {
  const age = currentYear - year;
  if (age < 0 || age > 2) return 0;
  return age === 0 ? 1 : age === 1 ? 0.55 : 0.3;
}

function teamRating(
  teamKey: string,
  currentYear: number,
  seasons: TeamSeasonSignal[],
  operational?: TeamOperationalSignal,
) {
  const eligible = seasons.filter((signal) => signal.teamKey === teamKey);
  let weightedEpa = 0;
  let weightedMatches = 0;
  let auto = 0;
  let endgame = 0;
  for (const signal of eligible) {
    const weight = seasonWeight(currentYear, signal.year);
    weightedEpa += signal.epa * signal.matches * weight;
    weightedMatches += signal.matches * weight;
    auto += (signal.autoEpa ?? 0) * signal.matches * weight;
    endgame += (signal.endgameEpa ?? 0) * signal.matches * weight;
  }
  const base = weightedMatches ? weightedEpa / weightedMatches : 0;
  const reliability = operational?.reliability == null ? 0.85 : clamp(operational.reliability / 100);
  const scoutWeight = Math.min(0.25, (operational?.scoutSample ?? 0) / 40);
  const research =
    (operational?.researchAdjustment ?? 0) *
    clamp(operational?.researchConfidence ?? 0) *
    0.15;
  const foulPenalty = Math.min(4, operational?.foulRate ?? 0);
  return {
    rating: base * (1 - scoutWeight + scoutWeight * reliability) + research - foulPenalty,
    sample: weightedMatches + (operational?.scoutSample ?? 0) * 0.5,
    auto: weightedMatches ? auto / weightedMatches : 0,
    endgame: weightedMatches ? endgame / weightedMatches : 0,
    reliability,
    foulPenalty,
  };
}

function citeSources(seasons: TeamSeasonSignal[], teamKeys: string[]) {
  const cited = seasons.filter((signal) => teamKeys.includes(signal.teamKey));
  const sources = [...new Set(cited.map((signal) => signal.source).filter(Boolean))];
  const eventKeys = [...new Set(cited.map((signal) => signal.eventKey).filter(Boolean))];
  const matchTotal = cited.reduce((sum, signal) => sum + signal.matches, 0);
  const parts = [
    sources.length ? `sources ${sources.join("+")}` : "reference metrics",
    eventKeys.length ? `event ${eventKeys.join(", ")}` : null,
    matchTotal > 0 ? `${matchTotal} weighted team-matches` : null,
  ].filter(Boolean);
  return parts.join(", ");
}

export function predictMatch(input: MatchPredictionInput): MatchPrediction {
  const operations = new Map((input.operations ?? []).map((value) => [value.teamKey, value]));
  const red = input.red.map((team) =>
    teamRating(team, input.currentYear, input.seasons, operations.get(team)),
  );
  const blue = input.blue.map((team) =>
    teamRating(team, input.currentYear, input.seasons, operations.get(team)),
  );
  const sum = (values: typeof red, key: keyof (typeof red)[number]) =>
    values.reduce((total, value) => total + Number(value[key]), 0);
  const redRating = sum(red, "rating");
  const blueRating = sum(blue, "rating");
  const margin = redRating - blueRating;
  const pRed = clamp(1 / (1 + Math.exp(-margin / 12)), 0.02, 0.98);
  const sample = sum(red, "sample") + sum(blue, "sample");
  const interval = clamp(0.28 / Math.sqrt(Math.max(1, sample / 12)), 0.05, 0.28);
  const eventBit = input.eventLabel ? ` at ${input.eventLabel}` : "";
  const citation = citeSources(input.seasons, [...input.red, ...input.blue]);
  const scoutSample = [...operations.values()].reduce((total, op) => total + (op.scoutSample ?? 0), 0);
  const factors: PredictionFactor[] = [
    {
      name: "weighted scoring",
      alliance: margin >= 0 ? "red" : "blue",
      impact: round(Math.abs(margin)),
      evidence: `Model weighted-current-v1${eventBit}: season weights 1.0 / 0.55 / 0.30. Alliance rating margin ${round(margin)} from ${citation}.`,
    },
  ];
  const autoMargin = sum(red, "auto") - sum(blue, "auto");
  if (Math.abs(autoMargin) >= 1)
    factors.push({
      name: "autonomous",
      alliance: autoMargin > 0 ? "red" : "blue",
      impact: round(Math.abs(autoMargin)),
      evidence: `Weighted autonomous EPA margin ${round(autoMargin)} (${citation}).`,
    });
  const foulMargin = sum(red, "foulPenalty") - sum(blue, "foulPenalty");
  if (Math.abs(foulMargin) >= 0.25)
    factors.push({
      name: "foul exposure",
      alliance: foulMargin > 0 ? "blue" : "red",
      impact: round(Math.abs(foulMargin)),
      evidence: `Org scout foul penalty (capped) margin ${round(Math.abs(foulMargin))}; not a TBA fact.`,
    });
  if (scoutSample > 0)
    factors.push({
      name: "scout reliability",
      alliance: "neutral",
      impact: round(Math.min(5, scoutSample / 8)),
      evidence: `${scoutSample} org scout observations blended into ratings (max 25% scout weight per team).`,
    });
  return {
    matchKey: input.matchKey,
    modelVersion: "weighted-current-v1",
    pRed: round(pRed),
    pBlue: round(1 - pRed),
    confidenceLow: round(clamp(pRed - interval)),
    confidenceHigh: round(clamp(pRed + interval)),
    effectiveSampleSize: round(sample),
    keyFactors: factors,
    caveats: [
      "MODEL output — not an official TBA result.",
      ...(sample < 30 ? ["Sparse historical/scouting sample; interval widened."] : []),
      scoutSample === 0
        ? "No org scout sample on this matchup; ratings use TBA/Statbotics event metrics only."
        : `Includes ${scoutSample} org scout observations as operational adjustments.`,
      "Prediction is decision support, not a guarantee.",
    ],
  };
}

export function runWhatIf(
  prediction: MatchPrediction,
  changes: Array<{ alliance: Alliance; label: string; pointDelta: number }>,
) {
  const baselineMargin = Math.log(prediction.pRed / prediction.pBlue) * 12;
  const delta = changes.reduce(
    (total, change) => total + (change.alliance === "red" ? change.pointDelta : -change.pointDelta),
    0,
  );
  const pRed = clamp(1 / (1 + Math.exp(-(baselineMargin + delta) / 12)), 0.02, 0.98);
  return {
    baseline: prediction.pRed,
    pRed: round(pRed),
    pBlue: round(1 - pRed),
    delta: round(pRed - prediction.pRed),
    assumptions: changes.map(({ alliance, label, pointDelta }) => ({ alliance, label, pointDelta })),
  };
}

export function buildStrategyPlaybook(input: {
  prediction: MatchPrediction;
  ourAlliance: Alliance;
  opponentFoulRisk?: "low" | "medium" | "high" | "unknown";
}) {
  const winProbability =
    input.ourAlliance === "red" ? input.prediction.pRed : input.prediction.pBlue;
  const opponent = input.ourAlliance === "red" ? "blue" : "red";
  const favorable = input.prediction.keyFactors.filter((factor) => factor.alliance === input.ourAlliance);
  const adverse = input.prediction.keyFactors.filter((factor) => factor.alliance === opponent);
  return {
    title: `${input.prediction.matchKey} ${input.ourAlliance.toUpperCase()} playbook`,
    winProbability,
    priorities: [
      ...(adverse.some((factor) => factor.name === "autonomous")
        ? ["Use a conservative autonomous route that avoids interference and preserves a clean start."]
        : ["Execute the highest-tested autonomous routine; define the missed-auto fallback before queueing."]),
      winProbability < 0.45
        ? "Assign disruption only to a practiced defender while preserving one reliable scoring lane."
        : "Protect cycle consistency; do not trade reliable scoring for speculative defense.",
      input.opponentFoulRisk === "high"
        ? "Avoid baiting contact; preserve driver-station video and let referees call unsafe or protected-zone contact."
        : "Set explicit protected-zone and contact limits in the driver briefing.",
    ],
    strengthsToProtect: favorable.map((factor) => factor.name),
    risksToMitigate: adverse.map((factor) => factor.name),
    checkpoints: ["after autonomous", "mid-match role check", "endgame transition"],
    debriefPrompts: [
      "Which prediction factor was wrong or missing?",
      "Did actual role execution match the plan?",
      "Record failures, fouls, and battery state before changing strategy.",
    ],
    provenance: input.prediction.keyFactors.map((factor) => factor.evidence),
  };
}

export function predictionAccuracy(
  outcomes: Array<{ pRed: number; winner: Alliance }>,
) {
  if (!outcomes.length) return { count: 0, accuracy: null, brierScore: null };
  const correct = outcomes.filter(({ pRed, winner }) => (pRed >= 0.5) === (winner === "red")).length;
  const brier =
    outcomes.reduce((sum, outcome) => sum + (outcome.pRed - (outcome.winner === "red" ? 1 : 0)) ** 2, 0) /
    outcomes.length;
  return { count: outcomes.length, accuracy: round(correct / outcomes.length), brierScore: round(brier) };
}
