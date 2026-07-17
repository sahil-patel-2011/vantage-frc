export type {
  Alliance,
  AllianceWinBreakdown,
  EvidenceKind,
  MatchCitation,
  MatchPrediction,
  MatchPredictionInput,
  MatchResultFact,
  PredictionFactor,
  TeamContribution,
  TeamOperationalSignal,
  TeamSeasonSignal,
} from "./types";
export * from "./signals";
export * from "./scout-ops";
export * from "./dossier";
export { seasonWeight } from "./season-weight";
export {
  buildAllianceWinBreakdown,
  citeMatchResults,
  rateTeam,
} from "./alliance-outcome";

import type {
  Alliance,
  MatchPrediction,
  MatchPredictionInput,
  PredictionFactor,
} from "./types";
import { buildAllianceWinBreakdown, rateTeam } from "./alliance-outcome";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;

function citeSources(
  seasons: MatchPredictionInput["seasons"],
  teamKeys: string[],
) {
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

/**
 * Win/loss match-outcome engine (weighted-current-v1).
 * Grounded in TBA/Statbotics season signals + optional scout ops.
 * Labels MODEL vs FACT; cites completed matches when `matchResults` provided.
 */
export function predictMatch(input: MatchPredictionInput): MatchPrediction {
  const breakdown = buildAllianceWinBreakdown(input);
  const operations = new Map((input.operations ?? []).map((value) => [value.teamKey, value]));
  const red = input.red.map((team) =>
    rateTeam(team, input.currentYear, input.seasons, operations.get(team)),
  );
  const blue = input.blue.map((team) =>
    rateTeam(team, input.currentYear, input.seasons, operations.get(team)),
  );
  const sum = (values: typeof red, key: keyof (typeof red)[number]) =>
    values.reduce((total, value) => total + Number(value[key]), 0);
  const margin = sum(red, "rating") - sum(blue, "rating");
  const eventBit = input.eventLabel ? ` at ${input.eventLabel}` : "";
  const citation = citeSources(input.seasons, [...input.red, ...input.blue]);
  const scoutSample = [...operations.values()].reduce((total, op) => total + (op.scoutSample ?? 0), 0);
  const allScoutEntryIds = [...operations.values()].flatMap((op) => op.scoutEntryIds ?? []);
  const foulEntryIds = [...operations.values()]
    .filter((op) => (op.foulRate ?? 0) >= 0.5)
    .flatMap((op) => op.scoutEntryIds ?? []);
  const capabilityEntryIds = [...operations.values()]
    .filter(
      (op) =>
        (op.autoCapability ?? 0) >= 0.35 ||
        (op.teleopCapability ?? 0) >= 0.35 ||
        (op.endgameCapability ?? 0) >= 0.35,
    )
    .flatMap((op) => op.scoutEntryIds ?? []);
  const autoCapTeams = [...operations.values()]
    .filter((op) => (op.autoCapability ?? 0) >= 0.45)
    .map((op) => op.teamKey);
  const teleopCapTeams = [...operations.values()]
    .filter((op) => (op.teleopCapability ?? 0) >= 0.45)
    .map((op) => op.teamKey);
  const scoutProvenanceBit = allScoutEntryIds.length
    ? ` Scout entries: ${allScoutEntryIds
        .slice(0, 8)
        .map((id) => id.slice(0, 8))
        .join(", ")}.`
    : "";

  const factors: PredictionFactor[] = [
    {
      name: "weighted scoring",
      alliance: margin >= 0 ? "red" : "blue",
      impact: round(Math.abs(margin)),
      evidence: `MODEL weighted-current-v1${eventBit}: season weights 1.0 / 0.55 / 0.30. Alliance rating margin ${round(margin)} from ${citation}.`,
      kind: "model",
    },
  ];
  const autoMargin = sum(red, "auto") - sum(blue, "auto");
  if (Math.abs(autoMargin) >= 1)
    factors.push({
      name: "autonomous",
      alliance: autoMargin > 0 ? "red" : "blue",
      impact: round(Math.abs(autoMargin)),
      evidence: `MODEL: Weighted autonomous EPA margin ${round(autoMargin)} (${citation}).${
        autoCapTeams.length ? ` Scout auto-capable: ${autoCapTeams.join(", ")}.` : ""
      }`,
      kind: "model",
      scoutEntryIds: capabilityEntryIds.length ? capabilityEntryIds.slice(0, 12) : undefined,
    });
  const foulMargin = sum(red, "foulPenalty") - sum(blue, "foulPenalty");
  if (Math.abs(foulMargin) >= 0.25)
    factors.push({
      name: "foul exposure",
      alliance: foulMargin > 0 ? "blue" : "red",
      impact: round(Math.abs(foulMargin)),
      evidence: `MODEL: Org scout foul penalty (capped) margin ${round(Math.abs(foulMargin))}; not a TBA fact.${scoutProvenanceBit}`,
      kind: "model",
      scoutEntryIds: foulEntryIds.length ? foulEntryIds : undefined,
    });
  if (scoutSample > 0)
    factors.push({
      name: "scout reliability",
      alliance: "neutral",
      impact: round(Math.min(5, scoutSample / 8)),
      evidence: `MODEL: ${scoutSample} org scout observations blended into ratings (max 25% scout weight per team; quality-weighted).${scoutProvenanceBit}`,
      kind: "model",
      scoutEntryIds: allScoutEntryIds.length ? allScoutEntryIds.slice(0, 24) : undefined,
    });
  if (capabilityEntryIds.length || autoCapTeams.length) {
    factors.push({
      name: "scout auto/teleop",
      alliance: "neutral",
      impact: round(Math.min(4, autoCapTeams.length + teleopCapTeams.length)),
      evidence: `MODEL: Scout-derived capabilities — auto ${autoCapTeams.join(", ") || "none"}; teleop ${teleopCapTeams.join(", ") || "none"}.${scoutProvenanceBit}`,
      kind: "model",
      scoutEntryIds: capabilityEntryIds.length ? capabilityEntryIds : undefined,
    });
  }

  for (const fact of breakdown.citations.slice(0, 4)) {
    factors.push({
      name: `match ${fact.matchKey}`,
      alliance: fact.winningAlliance ?? "neutral",
      impact: 1,
      evidence: fact.summary,
      kind: "fact",
    });
  }

  return {
    matchKey: breakdown.matchKey,
    modelVersion: breakdown.modelVersion,
    pRed: breakdown.pRed,
    pBlue: breakdown.pBlue,
    confidenceLow: breakdown.confidenceLow,
    confidenceHigh: breakdown.confidenceHigh,
    effectiveSampleSize: breakdown.effectiveSampleSize,
    keyFactors: factors,
    caveats: [
      "MODEL output — not an official TBA result.",
      ...(breakdown.effectiveSampleSize < 30
        ? ["Sparse historical/scouting sample; interval widened."]
        : []),
      scoutSample === 0
        ? "No org scout sample on this matchup; ratings use TBA/Statbotics event metrics only."
        : `Includes ${scoutSample} org scout observations as operational adjustments.`,
      breakdown.citations.length
        ? `${breakdown.citations.length} FACT TBA match result(s) cited for alliance context.`
        : "No completed TBA match results cited for these alliances yet.",
      "Prediction is decision support, not a guarantee.",
    ],
    citations: breakdown.citations,
    contributions: {
      red: breakdown.red,
      blue: breakdown.blue,
    },
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
  const topContribution = (
    input.ourAlliance === "red"
      ? input.prediction.contributions?.red
      : input.prediction.contributions?.blue
  )
    ?.slice()
    .sort((a, b) => b.contributionPts - a.contributionPts)[0];

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
      ...(topContribution
        ? [
            `Protect ${topContribution.teamKey.replace(/^frc/i, "")}'s modeled contribution (${Math.round(topContribution.shareOfAlliance * 100)}% of alliance rating).`,
          ]
        : []),
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
