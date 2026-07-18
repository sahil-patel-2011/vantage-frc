// Pure aggregation for the scouting schema A/B comparison. Deterministic given its input —
// a candidate with no logged samples simply gets zeroed/null stats, never a fabricated score.

export * from "./types";

import type { SchemaAbCandidate, SchemaAbComparison, SchemaAbSample, SchemaAbStats } from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** Fill time that reads as "fast" for scoring purposes; slower samples pull the score down. */
const FAST_FILL_SECONDS = 25;

export function computeCandidateStats(
  candidate: SchemaAbCandidate,
  samples: SchemaAbSample[],
): SchemaAbStats {
  const own = samples.filter((sample) => sample.candidateId === candidate.id);
  const sampleCount = own.length;

  if (sampleCount === 0) {
    return {
      candidateId: candidate.id,
      label: candidate.label,
      fieldCount: candidate.fieldCount,
      sampleCount: 0,
      avgCompletionRate: 0,
      errorRate: 0,
      avgFillSeconds: null,
      qualityScore: 0,
    };
  }

  let completionSum = 0;
  let errorCount = 0;
  let fillSecondsSum = 0;
  let fillSecondsCount = 0;

  for (const sample of own) {
    const rate = sample.fieldsTotal > 0 ? clamp01(sample.fieldsCompleted / sample.fieldsTotal) : 0;
    completionSum += rate;
    if (sample.hadError) errorCount += 1;
    if (sample.fillSeconds != null) {
      fillSecondsSum += sample.fillSeconds;
      fillSecondsCount += 1;
    }
  }

  const avgCompletionRate = round(completionSum / sampleCount);
  const errorRate = round(errorCount / sampleCount);
  const avgFillSeconds = fillSecondsCount > 0 ? round(fillSecondsSum / fillSecondsCount, 1) : null;

  const speedScore = avgFillSeconds != null ? clamp01(FAST_FILL_SECONDS / avgFillSeconds) : 0.5;
  const qualityScore = round(0.55 * avgCompletionRate + 0.25 * (1 - errorRate) + 0.2 * speedScore);

  return {
    candidateId: candidate.id,
    label: candidate.label,
    fieldCount: candidate.fieldCount,
    sampleCount,
    avgCompletionRate,
    errorRate,
    avgFillSeconds,
    qualityScore,
  };
}

export function compareCandidates(a: SchemaAbStats, b: SchemaAbStats): SchemaAbComparison {
  const reasons: string[] = [];

  if (a.sampleCount === 0 || b.sampleCount === 0) {
    return { a, b, winnerId: null, reasons: ["Both candidates need at least one logged sample to compare."] };
  }

  if (a.avgCompletionRate !== b.avgCompletionRate) {
    const leader = a.avgCompletionRate > b.avgCompletionRate ? a : b;
    reasons.push(`${leader.label} has higher field completion (${Math.round(leader.avgCompletionRate * 100)}%).`);
  }
  if (a.errorRate !== b.errorRate) {
    const leader = a.errorRate < b.errorRate ? a : b;
    reasons.push(`${leader.label} has a lower entry-error rate (${Math.round(leader.errorRate * 100)}%).`);
  }
  if (a.avgFillSeconds != null && b.avgFillSeconds != null && a.avgFillSeconds !== b.avgFillSeconds) {
    const leader = a.avgFillSeconds < b.avgFillSeconds ? a : b;
    reasons.push(`${leader.label} fills faster on average (${leader.avgFillSeconds}s).`);
  }

  let winnerId: string | null = null;
  if (a.qualityScore > b.qualityScore) winnerId = a.candidateId;
  else if (b.qualityScore > a.qualityScore) winnerId = b.candidateId;

  if (reasons.length === 0) reasons.push("Candidates are statistically even on the logged samples so far.");

  return { a, b, winnerId, reasons };
}

export function rankCandidates(stats: SchemaAbStats[]): SchemaAbStats[] {
  return [...stats].sort((x, y) => y.qualityScore - x.qualityScore || y.sampleCount - x.sampleCount);
}
