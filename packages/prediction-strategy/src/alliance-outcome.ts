import type {
  Alliance,
  AllianceWinBreakdown,
  MatchCitation,
  MatchPredictionInput,
  MatchResultFact,
  PredictionFactor,
  StrategyEngineId,
  TeamContribution,
  TeamOperationalSignal,
  TeamSeasonSignal,
} from "./types";
import {
  strategyEnginePolicyForId,
  type StrategyEnginePolicy,
} from "./engine-tier";
import { seasonWeight } from "./season-weight";

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const round = (value: number) => Math.round(value * 10_000) / 10_000;
const roundPct = (value: number) => Math.round(value * 1000) / 10;

export type TeamRatingDetail = {
  teamKey: string;
  rating: number;
  sample: number;
  auto: number;
  endgame: number;
  reliability: number;
  foulPenalty: number;
  sources: string[];
  eventKeys: string[];
  /** Event EPA minus year EPA when both exist (Max tier drift signal). */
  epaDrift?: number | null;
  scoutBlend?: number;
};

function preferStatboticsRows(
  eligible: TeamSeasonSignal[],
  prefer: boolean,
): TeamSeasonSignal[] {
  if (!prefer || eligible.length < 2) return eligible;
  const byKey = new Map<string, TeamSeasonSignal>();
  for (const signal of eligible) {
    const key = `${signal.year}|${signal.eventKey ?? ""}|${signal.teamKey}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, signal);
      continue;
    }
    const existingIsSb = (existing.source ?? "").toLowerCase() === "statbotics";
    const nextIsSb = (signal.source ?? "").toLowerCase() === "statbotics";
    if (nextIsSb && !existingIsSb) byKey.set(key, signal);
  }
  return [...byKey.values()];
}

export function rateTeam(
  teamKey: string,
  currentYear: number,
  seasons: TeamSeasonSignal[],
  operational?: TeamOperationalSignal,
  policy: StrategyEnginePolicy = strategyEnginePolicyForId("weighted-current-v1"),
): TeamRatingDetail {
  const mode = policy.thisSeasonOnly ? "this-season" : "recency";
  const eligible = preferStatboticsRows(
    seasons.filter((signal) => signal.teamKey === teamKey),
    policy.preferStatbotics,
  );
  let weightedEpa = 0;
  let weightedMatches = 0;
  let auto = 0;
  let endgame = 0;
  let eventEpaSum = 0;
  let eventEpaWeight = 0;
  let yearEpaSum = 0;
  let yearEpaWeight = 0;
  const sources = new Set<string>();
  const eventKeys = new Set<string>();
  for (const signal of eligible) {
    const weight = seasonWeight(currentYear, signal.year, mode);
    if (weight <= 0) continue;
    weightedEpa += signal.epa * signal.matches * weight;
    weightedMatches += signal.matches * weight;
    auto += (signal.autoEpa ?? 0) * signal.matches * weight;
    endgame += (signal.endgameEpa ?? 0) * signal.matches * weight;
    if (signal.source) sources.add(signal.source);
    if (signal.eventKey) {
      eventKeys.add(signal.eventKey);
      eventEpaSum += signal.epa * signal.matches * weight;
      eventEpaWeight += signal.matches * weight;
    } else {
      yearEpaSum += signal.epa * signal.matches * weight;
      yearEpaWeight += signal.matches * weight;
    }
  }
  const base = weightedMatches ? weightedEpa / weightedMatches : 0;
  const reliability = operational?.reliability == null ? 0.85 : clamp(operational.reliability / 100);
  const quality = operational?.qualityWeight == null ? 1 : clamp(operational.qualityWeight);
  const qualityScale = policy.scoutQualityEmphasis ? 0.55 + 0.45 * quality : quality;
  const scoutWeight = Math.min(
    policy.maxScoutBlend,
    ((operational?.scoutSample ?? 0) / 40) * qualityScale,
  );
  const research =
    (operational?.researchAdjustment ?? 0) *
    clamp(operational?.researchConfidence ?? 0) *
    (policy.tier === "max" ? 0.22 : policy.tier === "pro" ? 0.18 : 0.15);
  const foulCap = policy.tier === "max" ? 5.5 : policy.tier === "pro" ? 4.5 : 4;
  const foulPenalty = Math.min(foulCap, (operational?.foulRate ?? 0) * qualityScale);
  const scoutAutoBoost =
    (operational?.autoCapability ?? 0) * (policy.tier === "baseline" ? 2 : 2.6) * qualityScale;
  const scoutEndgameBoost =
    (operational?.endgameCapability ?? 0) * (policy.tier === "baseline" ? 2 : 2.6) * qualityScale;
  const teleopBoost =
    policy.tier === "baseline"
      ? 0
      : (operational?.teleopCapability ?? 0) * 1.8 * qualityScale;

  let epaDrift: number | null = null;
  if (policy.includeEpaDrift && eventEpaWeight > 0 && yearEpaWeight > 0) {
    epaDrift = eventEpaSum / eventEpaWeight - yearEpaSum / yearEpaWeight;
  }

  return {
    teamKey,
    rating:
      base * (1 - scoutWeight + scoutWeight * reliability) + research - foulPenalty + teleopBoost,
    sample: weightedMatches + (operational?.scoutSample ?? 0) * 0.5 * qualityScale,
    auto: (weightedMatches ? auto / weightedMatches : 0) + scoutAutoBoost,
    endgame: (weightedMatches ? endgame / weightedMatches : 0) + scoutEndgameBoost,
    reliability,
    foulPenalty,
    sources: [...sources],
    eventKeys: [...eventKeys],
    epaDrift,
    scoutBlend: scoutWeight,
  };
}

function logisticPRed(redRating: number, blueRating: number) {
  const margin = redRating - blueRating;
  return clamp(1 / (1 + Math.exp(-margin / 12)), 0.02, 0.98);
}

function sumRatings(teams: TeamRatingDetail[]) {
  return teams.reduce((total, team) => total + team.rating, 0);
}

function sumSample(teams: TeamRatingDetail[]) {
  return teams.reduce((total, team) => total + team.sample, 0);
}

/**
 * Map TBA-shaped completed matches into FACT citations for alliance teams.
 * Never invents winners — skips rows without a winning alliance.
 */
export function citeMatchResults(
  facts: MatchResultFact[],
  teamKeys: string[],
  limit = 8,
): MatchCitation[] {
  const wanted = new Set(teamKeys);
  const citations: MatchCitation[] = [];
  for (const fact of facts) {
    if (citations.length >= limit) break;
    const related = [...fact.red, ...fact.blue].filter((key) => wanted.has(key));
    if (!related.length) continue;
    if (fact.winningAlliance !== "red" && fact.winningAlliance !== "blue") continue;
    const winnerKeys = fact.winningAlliance === "red" ? fact.red : fact.blue;
    const loserKeys = fact.winningAlliance === "red" ? fact.blue : fact.red;
    const scoreBit =
      fact.redScore != null && fact.blueScore != null
        ? ` ${fact.redScore}–${fact.blueScore}`
        : "";
    const onWinner = related.filter((key) => winnerKeys.includes(key));
    const onLoser = related.filter((key) => loserKeys.includes(key));
    const outcomeBits: string[] = [];
    if (onWinner.length)
      outcomeBits.push(
        `${onWinner.map(shortTeam).join(", ")} won on ${fact.winningAlliance}`,
      );
    if (onLoser.length)
      outcomeBits.push(
        `${onLoser.map(shortTeam).join(", ")} lost on ${fact.winningAlliance === "red" ? "blue" : "red"}`,
      );
    citations.push({
      matchKey: fact.matchKey,
      kind: "fact",
      summary: `FACT TBA ${fact.matchKey}: ${outcomeBits.join("; ")}${scoreBit || ""}.`,
      relatedTeamKeys: related,
      winningAlliance: fact.winningAlliance,
      redScore: fact.redScore ?? null,
      blueScore: fact.blueScore ?? null,
    });
  }
  return citations;
}

function shortTeam(teamKey: string) {
  return teamKey.replace(/^frc/i, "");
}

function contributionEvidence(detail: TeamRatingDetail, shareOfAlliance: number): string {
  const sourceBit = detail.sources.length
    ? detail.sources.join("+")
    : "reference metrics";
  const eventBit = detail.eventKeys.length ? ` · ${detail.eventKeys.join(", ")}` : "";
  const blendBit =
    detail.scoutBlend != null && detail.scoutBlend > 0
      ? ` · scout blend ${roundPct(detail.scoutBlend)}%`
      : "";
  return `MODEL: ${shortTeam(detail.teamKey)} is ${roundPct(shareOfAlliance)}% of alliance rating (${round(detail.rating)} pts from ${sourceBit}${eventBit}${blendBit}; sample ${round(detail.sample)}).`;
}

function resolvePolicy(engineId?: StrategyEngineId): StrategyEnginePolicy {
  return strategyEnginePolicyForId(engineId ?? "weighted-current-v1");
}

/**
 * Alliance-level (3v3) win probability with per-team contribution breakdown.
 * Contributions use leave-one-out Δp so each robot's impact on p(red) is explicit and MODEL-labeled.
 */
export function buildAllianceWinBreakdown(
  input: MatchPredictionInput & { matchResults?: MatchResultFact[] },
): AllianceWinBreakdown {
  const policy = resolvePolicy(input.engineId);
  const operations = new Map((input.operations ?? []).map((value) => [value.teamKey, value]));
  const rate = (teamKey: string) =>
    rateTeam(teamKey, input.currentYear, input.seasons, operations.get(teamKey), policy);

  const redDetails = input.red.map(rate);
  const blueDetails = input.blue.map(rate);
  const redTotal = sumRatings(redDetails);
  const blueTotal = sumRatings(blueDetails);
  const pRedFull = logisticPRed(redTotal, blueTotal);
  const sample = sumSample(redDetails) + sumSample(blueDetails);
  const intervalBase = policy.tier === "max" ? 0.24 : policy.tier === "pro" ? 0.26 : 0.28;
  const interval = clamp(intervalBase / Math.sqrt(Math.max(1, sample / 12)), 0.04, 0.28);

  const red: TeamContribution[] = redDetails.map((detail) => {
    const without = sumRatings(redDetails.filter((row) => row.teamKey !== detail.teamKey));
    const pWithout = logisticPRed(without, blueTotal);
    const deltaPRed = pRedFull - pWithout;
    const shareOfAlliance = redTotal > 0 ? detail.rating / redTotal : 0;
    return {
      teamKey: detail.teamKey,
      alliance: "red" as Alliance,
      rating: round(detail.rating),
      shareOfAlliance: round(shareOfAlliance),
      shareOfMatch: round(
        redTotal + blueTotal > 0 ? detail.rating / (redTotal + blueTotal) : 0,
      ),
      contributionPts: round(detail.rating),
      deltaPRed: round(deltaPRed),
      evidence: contributionEvidence(detail, shareOfAlliance),
      kind: "model" as const,
    };
  });

  const blue: TeamContribution[] = blueDetails.map((detail) => {
    const without = sumRatings(blueDetails.filter((row) => row.teamKey !== detail.teamKey));
    const pWithout = logisticPRed(redTotal, without);
    const deltaPRed = pRedFull - pWithout;
    const shareOfAlliance = blueTotal > 0 ? detail.rating / blueTotal : 0;
    return {
      teamKey: detail.teamKey,
      alliance: "blue" as Alliance,
      rating: round(detail.rating),
      shareOfAlliance: round(shareOfAlliance),
      shareOfMatch: round(
        redTotal + blueTotal > 0 ? detail.rating / (redTotal + blueTotal) : 0,
      ),
      contributionPts: round(detail.rating),
      deltaPRed: round(deltaPRed),
      evidence: contributionEvidence(detail, shareOfAlliance),
      kind: "model" as const,
    };
  });

  const citations = citeMatchResults(input.matchResults ?? [], [...input.red, ...input.blue]);

  const seasonBit = policy.thisSeasonOnly
    ? "this-season signals only"
    : "season weights 1.0 / 0.55 / 0.30";
  const keyFactors: PredictionFactor[] = [
    {
      name: "alliance EPA margin",
      alliance: redTotal >= blueTotal ? "red" : "blue",
      impact: round(Math.abs(redTotal - blueTotal)),
      evidence: `MODEL ${policy.engineId}: red rating ${round(redTotal)} vs blue ${round(blueTotal)} (margin ${round(redTotal - blueTotal)}; ${seasonBit}).`,
      kind: "model",
    },
  ];

  const topRed = [...red].sort((a, b) => b.contributionPts - a.contributionPts)[0];
  const topBlue = [...blue].sort((a, b) => b.contributionPts - a.contributionPts)[0];
  if (topRed) {
    keyFactors.push({
      name: "red contribution lead",
      alliance: "red",
      impact: round(Math.abs(topRed.deltaPRed) * 100),
      evidence: `MODEL: ${shortTeam(topRed.teamKey)} leave-one-out Δp(red)=${round(topRed.deltaPRed)} (${roundPct(topRed.shareOfAlliance)}% of red rating).`,
      kind: "model",
    });
  }
  if (topBlue) {
    keyFactors.push({
      name: "blue contribution lead",
      alliance: "blue",
      impact: round(Math.abs(topBlue.deltaPRed) * 100),
      evidence: `MODEL: ${shortTeam(topBlue.teamKey)} leave-one-out Δp(red)=${round(topBlue.deltaPRed)} (${roundPct(topBlue.shareOfAlliance)}% of blue rating).`,
      kind: "model",
    });
  }

  if (policy.fullLeaveOneOutFactors) {
    for (const row of [...red, ...blue]
      .filter((item) => item !== topRed && item !== topBlue)
      .sort((a, b) => Math.abs(b.deltaPRed) - Math.abs(a.deltaPRed))
      .slice(0, 4)) {
      keyFactors.push({
        name: `${row.alliance} leave-one-out ${shortTeam(row.teamKey)}`,
        alliance: row.alliance,
        impact: round(Math.abs(row.deltaPRed) * 100),
        evidence: `MODEL leave-one-out: removing ${shortTeam(row.teamKey)} changes p(red) by ${round(row.deltaPRed)}.`,
        kind: "model",
      });
    }
  }

  if (policy.includeEpaDrift) {
    for (const detail of [...redDetails, ...blueDetails]) {
      if (detail.epaDrift == null || Math.abs(detail.epaDrift) < 1.5) continue;
      const alliance: Alliance = input.red.includes(detail.teamKey) ? "red" : "blue";
      keyFactors.push({
        name: `EPA drift ${shortTeam(detail.teamKey)}`,
        alliance,
        impact: round(Math.abs(detail.epaDrift)),
        evidence: `MODEL: ${shortTeam(detail.teamKey)} event-vs-year EPA drift ${round(detail.epaDrift)} (positive = hotter at this event; from real cached metrics only).`,
        kind: "model",
      });
    }
  }

  for (const citation of citations.slice(0, 3)) {
    keyFactors.push({
      name: `match ${citation.matchKey}`,
      alliance: citation.winningAlliance ?? "neutral",
      impact: 1,
      evidence: citation.summary,
      kind: "fact",
    });
  }

  return {
    matchKey: input.matchKey,
    modelVersion: policy.engineId,
    pRed: round(pRedFull),
    pBlue: round(1 - pRedFull),
    confidenceLow: round(clamp(pRedFull - interval)),
    confidenceHigh: round(clamp(pRedFull + interval)),
    effectiveSampleSize: round(sample),
    red,
    blue,
    citations,
    keyFactors,
    caveats: [
      "MODEL output — not an official TBA result.",
      `Engine ${policy.engineId} (depth ${policy.depth}).`,
      "Per-team Δp values are leave-one-out MODEL attributions, not TBA facts.",
      ...(policy.thisSeasonOnly
        ? ["This-season rules only — prior-year EPA is not blended."]
        : []),
      ...(citations.length
        ? [`${citations.length} FACT match result(s) cited from TBA-shaped schedule.`]
        : ["No completed TBA match results cited for these alliances yet."]),
      ...(sample < 30 ? ["Sparse historical/scouting sample; interval widened."] : []),
    ],
  };
}
