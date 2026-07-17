import type {
  Alliance,
  AllianceWinBreakdown,
  MatchCitation,
  MatchPredictionInput,
  MatchResultFact,
  PredictionFactor,
  TeamContribution,
  TeamOperationalSignal,
  TeamSeasonSignal,
} from "./types";
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
};

export function rateTeam(
  teamKey: string,
  currentYear: number,
  seasons: TeamSeasonSignal[],
  operational?: TeamOperationalSignal,
): TeamRatingDetail {
  const eligible = seasons.filter((signal) => signal.teamKey === teamKey);
  let weightedEpa = 0;
  let weightedMatches = 0;
  let auto = 0;
  let endgame = 0;
  const sources = new Set<string>();
  const eventKeys = new Set<string>();
  for (const signal of eligible) {
    const weight = seasonWeight(currentYear, signal.year);
    weightedEpa += signal.epa * signal.matches * weight;
    weightedMatches += signal.matches * weight;
    auto += (signal.autoEpa ?? 0) * signal.matches * weight;
    endgame += (signal.endgameEpa ?? 0) * signal.matches * weight;
    if (signal.source) sources.add(signal.source);
    if (signal.eventKey) eventKeys.add(signal.eventKey);
  }
  const base = weightedMatches ? weightedEpa / weightedMatches : 0;
  const reliability = operational?.reliability == null ? 0.85 : clamp(operational.reliability / 100);
  const quality = operational?.qualityWeight == null ? 1 : clamp(operational.qualityWeight);
  const scoutWeight = Math.min(0.25, ((operational?.scoutSample ?? 0) / 40) * quality);
  const research =
    (operational?.researchAdjustment ?? 0) *
    clamp(operational?.researchConfidence ?? 0) *
    0.15;
  const foulPenalty = Math.min(4, (operational?.foulRate ?? 0) * quality);
  // Blend scout auto/teleop/endgame hints lightly into phase ratings when EPA is thin.
  const scoutAutoBoost = (operational?.autoCapability ?? 0) * 2 * quality;
  const scoutEndgameBoost = (operational?.endgameCapability ?? 0) * 2 * quality;
  return {
    teamKey,
    rating: base * (1 - scoutWeight + scoutWeight * reliability) + research - foulPenalty,
    sample: weightedMatches + (operational?.scoutSample ?? 0) * 0.5 * quality,
    auto: (weightedMatches ? auto / weightedMatches : 0) + scoutAutoBoost,
    endgame: (weightedMatches ? endgame / weightedMatches : 0) + scoutEndgameBoost,
    reliability,
    foulPenalty,
    sources: [...sources],
    eventKeys: [...eventKeys],
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
  return `MODEL: ${shortTeam(detail.teamKey)} is ${roundPct(shareOfAlliance)}% of alliance rating (${round(detail.rating)} pts from ${sourceBit}${eventBit}; sample ${round(detail.sample)}).`;
}

/**
 * Alliance-level (3v3) win probability with per-team contribution breakdown.
 * Contributions use leave-one-out Δp so each robot's impact on p(red) is explicit and MODEL-labeled.
 */
export function buildAllianceWinBreakdown(
  input: MatchPredictionInput & { matchResults?: MatchResultFact[] },
): AllianceWinBreakdown {
  const operations = new Map((input.operations ?? []).map((value) => [value.teamKey, value]));
  const rate = (teamKey: string) =>
    rateTeam(teamKey, input.currentYear, input.seasons, operations.get(teamKey));

  const redDetails = input.red.map(rate);
  const blueDetails = input.blue.map(rate);
  const redTotal = sumRatings(redDetails);
  const blueTotal = sumRatings(blueDetails);
  const pRedFull = logisticPRed(redTotal, blueTotal);
  const sample = sumSample(redDetails) + sumSample(blueDetails);
  const interval = clamp(0.28 / Math.sqrt(Math.max(1, sample / 12)), 0.05, 0.28);

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
    // Removing a blue robot raises p(red); their contribution to blue is −ΔpRed.
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

  const keyFactors: PredictionFactor[] = [
    {
      name: "alliance EPA margin",
      alliance: redTotal >= blueTotal ? "red" : "blue",
      impact: round(Math.abs(redTotal - blueTotal)),
      evidence: `MODEL weighted-current-v1: red rating ${round(redTotal)} vs blue ${round(blueTotal)} (margin ${round(redTotal - blueTotal)}).`,
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
    modelVersion: "weighted-current-v1",
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
      "Per-team Δp values are leave-one-out MODEL attributions, not TBA facts.",
      ...(citations.length
        ? [`${citations.length} FACT match result(s) cited from TBA-shaped schedule.`]
        : ["No completed TBA match results cited for these alliances yet."]),
      ...(sample < 30 ? ["Sparse historical/scouting sample; interval widened."] : []),
    ],
  };
}
