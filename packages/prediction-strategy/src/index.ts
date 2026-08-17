export type {
  Alliance,
  AllianceWinBreakdown,
  EvidenceKind,
  MatchCitation,
  MatchPrediction,
  MatchPredictionInput,
  MatchResultFact,
  PredictionFactor,
  StrategyEngineId,
  StrategyReasoningStep,
  TeamContribution,
  TeamOperationalSignal,
  TeamSeasonSignal,
} from "./types";
export * from "./signals";
export * from "./scout-ops";
export * from "./dossier";
export {
  PLAN_TO_ENGINE_ID,
  normalizePlanCode,
  selectStrategyEngine,
  strategyEnginePolicyForId,
  toEngineSummary,
  type StrategyEnginePolicy,
  type StrategyEngineSummary,
  type StrategyEngineTier,
} from "./engine-tier";
export { seasonWeight } from "./season-weight";
export {
  buildAllianceWinBreakdown,
  citeMatchResults,
  rateTeam,
} from "./alliance-outcome";
export {
  MIN_PEPA_SAMPLE,
  PRIVATE_EPA_PUBLIC_WEIGHT,
  PRIVATE_EPA_SCOUT_WEIGHT,
  blendPrivateEpa,
  buildComponentDifferentials,
  buildOpponentProfile,
  buildPrivateEdgeView,
  clusterPitSignals,
  cycleTimeFromObservations,
  extractCycleTimeSeconds,
  extractPitSignals,
  forecastDigitalTwin,
  linkCadToScout,
  scoutedComponentEpa,
  simulateCounterPick,
  crossSeasonVsOpponent,
  type CadScoutLink,
  type ComponentDifferential,
  type CrossSeasonNote,
  type DigitalTwinForecast,
  type OpponentProfile,
  type PitSignal,
  type PrivateEdgeView,
  type PrivateEpaResult,
  type PrivateEpaSkip,
  type ScoutCalibration,
  type ScoutComponentRates,
  type ScoutEvidenceCard,
  type ScoutMatchObservation,
} from "./private-edge";

import type {
  Alliance,
  MatchPrediction,
  MatchPredictionInput,
  PredictionFactor,
  StrategyReasoningStep,
} from "./types";
import { strategyEnginePolicyForId } from "./engine-tier";
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

function buildReasoningSteps(input: {
  engineId: string;
  depth: number;
  thisSeasonOnly: boolean;
  margin: number;
  scoutSample: number;
  citation: string;
  factCount: number;
  leaveOneOutCount: number;
  epaDriftCount: number;
}): StrategyReasoningStep[] {
  const steps: StrategyReasoningStep[] = [
    {
      step: 1,
      title: "Ground ratings in cached metrics",
      detail: `Use Neon last-good TBA/Statbotics signals only (${input.citation || "no linked source yet"}). Missing EPA is skipped — never invented.`,
    },
    {
      step: 2,
      title: input.thisSeasonOnly ? "Apply this-season rules" : "Apply recency season weights",
      detail: input.thisSeasonOnly
        ? "Only current-season signals contribute (prior years weight 0)."
        : "Season weights 1.0 / 0.55 / 0.30 for current / prior / two-back.",
    },
    {
      step: 3,
      title: "Blend org scout trust",
      detail:
        input.scoutSample > 0
          ? `${input.scoutSample} org scout observations quality-weighted into ratings (MODEL adjustments, not TBA facts).`
          : "No org scout sample on this matchup; ratings use reference metrics only.",
    },
    {
      step: 4,
      title: "Score alliance margin",
      detail: `Logistic win model on alliance rating margin ${round(input.margin)} via engine ${input.engineId} (depth ${input.depth}).`,
    },
  ];
  if (input.leaveOneOutCount > 0) {
    steps.push({
      step: steps.length + 1,
      title: "Explain leave-one-out contributions",
      detail: `${input.leaveOneOutCount} leave-one-out Δp attributions surface each robot's modeled impact on p(red).`,
    });
  }
  if (input.epaDriftCount > 0) {
    steps.push({
      step: steps.length + 1,
      title: "Surface EPA drift",
      detail: `${input.epaDriftCount} event-vs-year EPA drift factor(s) from real cached metrics.`,
    });
  }
  if (input.factCount > 0) {
    steps.push({
      step: steps.length + 1,
      title: "Cite completed TBA matches",
      detail: `${input.factCount} FACT match result(s) cited; unscored matches are skipped.`,
    });
  }
  steps.push({
    step: steps.length + 1,
    title: "Optional metered AI deepen",
    detail:
      "When metered AI is enabled for this org, extra narrative reasoning can expand these steps — still without inventing DEMO stats.",
  });
  return steps;
}

/**
 * Win/loss match-outcome engine.
 * Engine id comes from org plan entitlements (Free/Access baseline → Pro → Max).
 * Grounded in TBA/Statbotics season signals + optional scout ops.
 * Labels MODEL vs FACT; cites completed matches when `matchResults` provided.
 */
export function predictMatch(input: MatchPredictionInput): MatchPrediction {
  const policy = strategyEnginePolicyForId(input.engineId ?? "weighted-current-v1");
  const engineInput = { ...input, engineId: policy.engineId };
  const breakdown = buildAllianceWinBreakdown(engineInput);
  const operations = new Map((input.operations ?? []).map((value) => [value.teamKey, value]));
  const red = input.red.map((team) =>
    rateTeam(team, input.currentYear, input.seasons, operations.get(team), policy),
  );
  const blue = input.blue.map((team) =>
    rateTeam(team, input.currentYear, input.seasons, operations.get(team), policy),
  );
  const sum = (values: typeof red, key: keyof (typeof red)[number]) =>
    values.reduce((total, value) => total + Number(value[key] ?? 0), 0);
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
  const qualityNotes = [...operations.values()].flatMap((op) => op.qualityNotes ?? []);
  const scoutProvenanceBit = allScoutEntryIds.length
    ? ` Scout entries: ${allScoutEntryIds
        .slice(0, 8)
        .map((id) => id.slice(0, 8))
        .join(", ")}.`
    : "";

  const seasonBit = policy.thisSeasonOnly
    ? "this-season signals only"
    : "season weights 1.0 / 0.55 / 0.30";
  const factors: PredictionFactor[] = [
    {
      name: "weighted scoring",
      alliance: margin >= 0 ? "red" : "blue",
      impact: round(Math.abs(margin)),
      evidence: `MODEL ${policy.engineId}${eventBit}: ${seasonBit}. Alliance rating margin ${round(margin)} from ${citation}.`,
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
      evidence: `MODEL: ${scoutSample} org scout observations blended into ratings (max ${Math.round(policy.maxScoutBlend * 100)}% scout weight per team; quality-weighted).${scoutProvenanceBit}`,
      kind: "model",
      scoutEntryIds: allScoutEntryIds.length ? allScoutEntryIds.slice(0, 24) : undefined,
    });
  if (capabilityEntryIds.length || autoCapTeams.length || teleopCapTeams.length) {
    factors.push({
      name: "scout auto/teleop",
      alliance: "neutral",
      impact: round(Math.min(4, autoCapTeams.length + teleopCapTeams.length)),
      evidence: `MODEL: Scout-derived capabilities — auto ${autoCapTeams.join(", ") || "none"}; teleop ${teleopCapTeams.join(", ") || "none"}.${scoutProvenanceBit}`,
      kind: "model",
      scoutEntryIds: capabilityEntryIds.length ? capabilityEntryIds : undefined,
    });
  }

  if (policy.tier !== "baseline" && scoutSample > 0) {
    const avgQuality =
      [...operations.values()].reduce((total, op) => total + (op.qualityWeight ?? 1), 0) /
      Math.max(1, operations.size);
    factors.push({
      name: "TBA+scout trust blend",
      alliance: "neutral",
      impact: round(Math.min(6, policy.maxScoutBlend * 10 * avgQuality)),
      evidence: `MODEL ${policy.engineId}: TBA/Statbotics base with scout trust blend capped at ${Math.round(policy.maxScoutBlend * 100)}% (mean quality weight ${round(avgQuality)}).${
        qualityNotes.length ? ` Quality notes: ${qualityNotes.slice(0, 3).join("; ")}.` : ""
      }`,
      kind: "model",
      scoutEntryIds: allScoutEntryIds.length ? allScoutEntryIds.slice(0, 16) : undefined,
    });
  }

  if (policy.thisSeasonOnly) {
    factors.push({
      name: "this-season rules",
      alliance: "neutral",
      impact: 1,
      evidence: `MODEL ${policy.engineId}: only ${input.currentYear} season signals contribute — prior-year EPA is excluded.`,
      kind: "model",
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

  // Surface Max-only breakdown factors (EPA drift / full leave-one-out) in the prediction too.
  if (policy.tier === "max") {
    for (const factor of breakdown.keyFactors) {
      if (
        factor.name.startsWith("EPA drift") ||
        factor.name.includes("leave-one-out")
      ) {
        if (!factors.some((existing) => existing.name === factor.name)) {
          factors.push(factor);
        }
      }
    }
  }

  const reasoningSteps = policy.extraReasoningSteps
    ? buildReasoningSteps({
        engineId: policy.engineId,
        depth: policy.depth,
        thisSeasonOnly: policy.thisSeasonOnly,
        margin,
        scoutSample,
        citation,
        factCount: breakdown.citations.length,
        leaveOneOutCount: factors.filter((f) => f.name.includes("leave-one-out")).length,
        epaDriftCount: factors.filter((f) => f.name.startsWith("EPA drift")).length,
      })
    : undefined;

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
      `Engine ${policy.engineId} · depth ${policy.depth} · ${policy.label}.`,
      ...(breakdown.effectiveSampleSize < 30
        ? ["Sparse historical/scouting sample; interval widened."]
        : []),
      scoutSample === 0
        ? "No org scout sample on this matchup; ratings use TBA/Statbotics event metrics only."
        : `Includes ${scoutSample} org scout observations as operational adjustments.`,
      breakdown.citations.length
        ? `${breakdown.citations.length} FACT TBA match result(s) cited for alliance context.`
        : "No completed TBA match results cited for these alliances yet.",
      ...(policy.thisSeasonOnly
        ? ["This-season rules only — prior-year EPA is not blended."]
        : []),
      "Prediction is decision support, not a guarantee.",
    ],
    citations: breakdown.citations,
    contributions: {
      red: breakdown.red,
      blue: breakdown.blue,
    },
    reasoningSteps,
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
