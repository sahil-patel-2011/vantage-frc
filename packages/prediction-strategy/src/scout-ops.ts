/**
 * Scout → strategy operational bridge.
 * Derives auto/teleop/endgame capabilities, pit notes, scout-quality weights,
 * and entry-level provenance for strategy callouts.
 */

export type ScoutEntryKind = "match" | "pit";

export type ScoutEntryRecord = {
  id: string;
  teamKey: string;
  entryType: ScoutEntryKind;
  matchKey?: string | null;
  scoutUserId?: string | null;
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
  updatedAt?: string | null;
};

export type ScoutInfluence =
  | "reliability"
  | "foul_rate"
  | "auto_capability"
  | "teleop_capability"
  | "endgame_capability"
  | "defense"
  | "pit_note"
  | "quality_downweight"
  | "excluded_low_confidence";

export type ScoutProvenanceRef = {
  entryId: string;
  entryType: ScoutEntryKind;
  teamKey: string;
  matchKey?: string | null;
  scoutUserId?: string | null;
  influence: ScoutInfluence;
  weight: number;
};

export type ScoutCapabilityProfile = {
  /** 0–1 mean auto contribution from match scouts (null if unknown). */
  autoRate: number | null;
  /** 0–1 mean teleop/cycle contribution. */
  teleopRate: number | null;
  /** 0–1 mean endgame/climb signal. */
  endgameRate: number | null;
  defenseLikely: boolean;
  sampleSize: number;
  evidence: string[];
};

export type ScoutQualityScoutReport = {
  scoutUserId: string;
  entryCount: number;
  meanScore: number | null;
  deviationFromTeam: number | null;
  weight: number;
  reason: string;
};

export type ScoutQualityReport = {
  /** Mean entry weight after confidence + anomaly downweighting (0.35–1). */
  meanWeight: number;
  /** Effective sample = sum of entry weights. */
  effectiveSample: number;
  byEntryId: Record<string, number>;
  scouts: ScoutQualityScoutReport[];
  transparency: string[];
};

export type BuiltOperationalSignal = {
  teamKey: string;
  scoutSample: number;
  reliability?: number;
  foulRate?: number;
  qualityWeight?: number;
  autoCapability?: number;
  teleopCapability?: number;
  endgameCapability?: number;
  defenseLikely?: boolean;
  pitNotes: string[];
  provenance: ScoutProvenanceRef[];
  quality: ScoutQualityReport;
  capabilityEvidence: string[];
};

const SCORE_KEYS = ["totalPoints", "score", "cycles", "gamePieces", "teleopCycles"] as const;
const FOUL_KEYS = ["fouls", "foulCount", "penalties"] as const;
const AUTO_KEYS = [
  "auto",
  "autoPoints",
  "autoScore",
  "autoPieces",
  "autoCoral",
  "autoNotes",
  "mobility",
  "autoMobility",
] as const;
const TELEOP_KEYS = [
  "teleop",
  "teleopPoints",
  "teleopScore",
  "cycles",
  "teleopCycles",
  "gamePieces",
  "teleopCoral",
] as const;
const ENDGAME_KEYS = ["climb", "endgame", "park", "trap", "climbLevel", "endgamePoints"] as const;
const NOTE_KEYS = ["notes", "note", "comments", "pitNotes", "observations", "summary"] as const;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

function firstFinite(payload: Record<string, unknown>, keys: readonly string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (finite(value)) return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function confidenceBaseWeight(confidence: ScoutEntryRecord["confidence"]) {
  if (confidence === "high") return 1;
  if (confidence === "low") return 0.35;
  return 0.85;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function shortId(id: string) {
  return id.slice(0, 8);
}

/** Extract free-text pit / match notes from flexible schema payloads. */
export function extractNotes(payload: Record<string, unknown>): string[] {
  const notes: string[] = [];
  for (const key of NOTE_KEYS) {
    const value = payload[key];
    if (typeof value === "string" && value.trim().length >= 3) {
      notes.push(value.trim().slice(0, 280));
    }
  }
  return notes;
}

export function deriveScoutCapabilities(
  observations: Array<{ payload: Record<string, unknown>; weight?: number }>,
): ScoutCapabilityProfile {
  if (!observations.length) {
    return {
      autoRate: null,
      teleopRate: null,
      endgameRate: null,
      defenseLikely: false,
      sampleSize: 0,
      evidence: [],
    };
  }

  const weightedMean = (keys: readonly string[]) => {
    let sum = 0;
    let weightSum = 0;
    for (const obs of observations) {
      const value = firstFinite(obs.payload, keys);
      if (value == null) continue;
      const w = obs.weight ?? 1;
      sum += value * w;
      weightSum += w;
    }
    if (!weightSum) return null;
    const mean = sum / weightSum;
    // Normalize loosely: treat values > 1 as counts/points (cap at 12 → 1.0)
    return clamp(mean > 1 ? mean / 12 : mean, 0, 1);
  };

  const autoRate = weightedMean(AUTO_KEYS);
  const teleopRate = weightedMean(TELEOP_KEYS);
  const endgameRate = weightedMean(ENDGAME_KEYS);
  const defenseLikely = observations.some(({ payload }) => {
    const text = JSON.stringify(payload).toLowerCase();
    return /\bdefen[cs]e\b/.test(text) || payload.defense === true || payload.playedDefense === true;
  });

  const evidence: string[] = [];
  if (autoRate != null) evidence.push(`scout auto capability ~${Math.round(autoRate * 100)}%`);
  if (teleopRate != null) evidence.push(`scout teleop capability ~${Math.round(teleopRate * 100)}%`);
  if (endgameRate != null) evidence.push(`scout endgame capability ~${Math.round(endgameRate * 100)}%`);
  if (defenseLikely) evidence.push("defense noted in scout payloads");

  return {
    autoRate,
    teleopRate,
    endgameRate,
    defenseLikely,
    sampleSize: observations.length,
    evidence,
  };
}

/**
 * Downweight inconsistent scouts vs team median scoring, with confidence floors.
 * Transparent: every downweighted scout gets a reason string.
 */
export function computeScoutQuality(entries: ScoutEntryRecord[]): ScoutQualityReport {
  const matchEntries = entries.filter((entry) => entry.entryType === "match");
  const scored = matchEntries
    .map((entry) => ({
      entry,
      score: firstFinite(entry.payload, SCORE_KEYS),
    }))
    .filter((row): row is { entry: ScoutEntryRecord; score: number } => row.score != null);

  const teamMedian = median(scored.map((row) => row.score));
  const deviations = scored
    .map((row) => (teamMedian != null ? Math.abs(row.score - teamMedian) : 0))
    .filter((value) => value > 0);
  const mad = median(deviations) ?? 0;

  const byScout = new Map<string, { scores: number[]; entryIds: string[] }>();
  for (const row of scored) {
    const scoutId = row.entry.scoutUserId ?? `anon:${row.entry.id}`;
    const bucket = byScout.get(scoutId) ?? { scores: [], entryIds: [] };
    bucket.scores.push(row.score);
    bucket.entryIds.push(row.entry.id);
    byScout.set(scoutId, bucket);
  }

  const scoutMeans = [...byScout.entries()].map(([scoutUserId, bucket]) => ({
    scoutUserId,
    mean: bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length,
  }));

  // Majority cluster: prefer the scoring island with the most agreeing scouts.
  let consensusMean = teamMedian;
  let bestCluster = 0;
  for (const candidate of scoutMeans) {
    const cluster = scoutMeans.filter((other) => {
      const denom = Math.max(Math.abs(candidate.mean), 1);
      return Math.abs(other.mean - candidate.mean) / denom <= 0.3;
    }).length;
    if (cluster > bestCluster) {
      bestCluster = cluster;
      consensusMean = candidate.mean;
    }
  }

  const scale = Math.max(
    mad > 0 ? mad : 0,
    consensusMean != null && Math.abs(consensusMean) > 0 ? Math.abs(consensusMean) * 0.2 : 1,
    1,
  );

  const scoutReports: ScoutQualityScoutReport[] = [];
  const scoutWeightById = new Map<string, number>();
  for (const [scoutUserId, bucket] of byScout) {
    const meanScore = bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length;
    const baseline = consensusMean ?? teamMedian;
    const deviationFromTeam = baseline != null ? meanScore - baseline : null;
    const z = deviationFromTeam != null ? Math.abs(deviationFromTeam) / scale : 0;
    const relative =
      baseline != null && Math.abs(baseline) > 0 ? Math.abs(meanScore / baseline - 1) : 0;
    const isMinority =
      bestCluster >= 2 &&
      scoutMeans.filter((other) => {
        const denom = Math.max(Math.abs(meanScore), 1);
        return Math.abs(other.mean - meanScore) / denom <= 0.3;
      }).length < bestCluster;
    const enoughSample = bucket.scores.length >= 2 || z >= 2 || relative >= 0.45;
    const anomalyWeight =
      isMinority && enoughSample
        ? clamp(1 - Math.max(0.22 * z, relative * 0.75), 0.35, 1)
        : enoughSample && relative >= 0.75
          ? clamp(1 - relative * 0.5, 0.45, 1)
          : 1;
    const reason =
      anomalyWeight < 0.95 && deviationFromTeam != null
        ? `Scoring mean ${round1(meanScore)} vs consensus ${round1(baseline!)} (Δ ${round1(deviationFromTeam)}); weight ${round2(anomalyWeight)}.`
        : `Consistent with scout consensus; weight ${round2(anomalyWeight)}.`;
    scoutReports.push({
      scoutUserId,
      entryCount: bucket.scores.length,
      meanScore,
      deviationFromTeam,
      weight: anomalyWeight,
      reason,
    });
    scoutWeightById.set(scoutUserId, anomalyWeight);
  }

  const byEntryId: Record<string, number> = {};
  let weightSum = 0;
  for (const entry of entries) {
    const scoutId = entry.scoutUserId ?? `anon:${entry.id}`;
    const anomaly = scoutWeightById.get(scoutId) ?? 1;
    const weight = clamp(confidenceBaseWeight(entry.confidence) * anomaly, 0.2, 1);
    byEntryId[entry.id] = weight;
    weightSum += weight;
  }

  const meanWeight = entries.length ? weightSum / entries.length : 1;
  const transparency = scoutReports
    .filter((report) => report.weight < 0.95)
    .map(
      (report) =>
        `Scout ${shortId(report.scoutUserId)} downweighted to ${Math.round(report.weight * 100)}%: ${report.reason}`,
    );

  if (!transparency.length && entries.length) {
    transparency.push(
      `Scout quality: mean weight ${Math.round(meanWeight * 100)}% across ${entries.length} entries (no anomaly downweights).`,
    );
  }

  return {
    meanWeight: round2(meanWeight),
    effectiveSample: round2(weightSum),
    byEntryId,
    scouts: scoutReports.sort((a, b) => a.weight - b.weight),
    transparency,
  };
}

function weightedRate(
  observations: ScoutEntryRecord[],
  weights: Record<string, number>,
  keys: readonly string[],
  minSamples = 3,
) {
  let sum = 0;
  let wSum = 0;
  let count = 0;
  for (const obs of observations) {
    const value = firstFinite(obs.payload, keys);
    if (value == null) continue;
    const w = weights[obs.id] ?? 1;
    sum += value * w;
    wSum += w;
    count += 1;
  }
  if (count < minSamples || !wSum) return null;
  return sum / wSum;
}

function weightedReliability(observations: ScoutEntryRecord[], weights: Record<string, number>) {
  if (!observations.length) return null;
  let failureWeight = 0;
  let totalWeight = 0;
  for (const obs of observations) {
    const w = weights[obs.id] ?? 1;
    totalWeight += w;
    const failed = [obs.payload.disabled, obs.payload.breakdown, obs.payload.noShow].some(Boolean);
    if (failed) failureWeight += w;
  }
  if (!totalWeight) return null;
  return clamp((1 - failureWeight / totalWeight) * 100, 0, 100);
}

/**
 * Build one team's operational signal from match + pit scout entries,
 * including capabilities, pit notes, quality weighting, and provenance refs.
 */
export function buildTeamOperationalSignal(
  teamKey: string,
  entries: ScoutEntryRecord[],
): BuiltOperationalSignal | null {
  const teamEntries = entries.filter((entry) => entry.teamKey === teamKey);
  if (!teamEntries.length) return null;

  const quality = computeScoutQuality(teamEntries);
  const matchEntries = teamEntries.filter((entry) => entry.entryType === "match");
  const pitEntries = teamEntries.filter((entry) => entry.entryType === "pit");

  const usableMatch = matchEntries.filter((entry) => entry.confidence !== "low");
  const excludedLow = matchEntries.filter((entry) => entry.confidence === "low");

  const reliability = weightedReliability(usableMatch, quality.byEntryId);
  const foulRate = weightedRate(usableMatch, quality.byEntryId, FOUL_KEYS, 3);
  const capabilities = deriveScoutCapabilities(
    [...usableMatch, ...pitEntries.filter((entry) => entry.confidence !== "low")].map((entry) => ({
      payload: entry.payload,
      weight: quality.byEntryId[entry.id] ?? 1,
    })),
  );

  const pitNotes = pitEntries.flatMap((entry) => extractNotes(entry.payload)).slice(0, 6);
  // Fall back to match notes when pit is empty
  const matchNotes =
    pitNotes.length === 0
      ? usableMatch.flatMap((entry) => extractNotes(entry.payload)).slice(0, 4)
      : [];
  const notes = [...pitNotes, ...matchNotes];

  const provenance: ScoutProvenanceRef[] = [];
  const pushProv = (
    entry: ScoutEntryRecord,
    influence: ScoutInfluence,
    weight = quality.byEntryId[entry.id] ?? 1,
  ) => {
    provenance.push({
      entryId: entry.id,
      entryType: entry.entryType,
      teamKey: entry.teamKey,
      matchKey: entry.matchKey ?? null,
      scoutUserId: entry.scoutUserId ?? null,
      influence,
      weight: round2(weight),
    });
  };

  for (const entry of usableMatch) {
    if (reliability != null) pushProv(entry, "reliability");
    if (foulRate != null && firstFinite(entry.payload, FOUL_KEYS) != null) {
      pushProv(entry, "foul_rate");
    }
    if (firstFinite(entry.payload, AUTO_KEYS) != null) pushProv(entry, "auto_capability");
    if (firstFinite(entry.payload, TELEOP_KEYS) != null) pushProv(entry, "teleop_capability");
    if (firstFinite(entry.payload, ENDGAME_KEYS) != null) pushProv(entry, "endgame_capability");
    const text = JSON.stringify(entry.payload).toLowerCase();
    if (/\bdefen[cs]e\b/.test(text) || entry.payload.defense === true) {
      pushProv(entry, "defense");
    }
  }
  for (const entry of pitEntries) {
    if (extractNotes(entry.payload).length) pushProv(entry, "pit_note");
    const text = JSON.stringify(entry.payload).toLowerCase();
    if (/\bdefen[cs]e\b/.test(text) || entry.payload.defense === true) {
      pushProv(entry, "defense");
    }
  }
  for (const entry of excludedLow) {
    pushProv(entry, "excluded_low_confidence", quality.byEntryId[entry.id] ?? 0.35);
  }
  for (const report of quality.scouts.filter((scout) => scout.weight < 0.95)) {
    const sample = teamEntries.find(
      (entry) => (entry.scoutUserId ?? `anon:${entry.id}`) === report.scoutUserId,
    );
    if (sample) pushProv(sample, "quality_downweight", report.weight);
  }

  const effectiveSample = usableMatch.reduce(
    (sum, entry) => sum + (quality.byEntryId[entry.id] ?? 1),
    0,
  );

  return {
    teamKey,
    scoutSample: Math.max(1, Math.round(effectiveSample * 10) / 10),
    reliability: reliability ?? undefined,
    foulRate: foulRate ?? undefined,
    qualityWeight: quality.meanWeight,
    autoCapability: capabilities.autoRate ?? undefined,
    teleopCapability: capabilities.teleopRate ?? undefined,
    endgameCapability: capabilities.endgameRate ?? undefined,
    defenseLikely: capabilities.defenseLikely || undefined,
    pitNotes: notes,
    provenance,
    quality,
    capabilityEvidence: capabilities.evidence,
  };
}

export function buildOperationsFromScoutEntries(entries: ScoutEntryRecord[]) {
  const teamKeys = [...new Set(entries.map((entry) => entry.teamKey))];
  const operations: BuiltOperationalSignal[] = [];
  for (const teamKey of teamKeys) {
    const built = buildTeamOperationalSignal(teamKey, entries);
    if (built) operations.push(built);
  }
  return operations;
}

/** Compact provenance line for UI / FACTOR evidence. */
export function formatScoutProvenance(refs: ScoutProvenanceRef[], limit = 6) {
  if (!refs.length) return "no scout entry ids";
  const influential = refs.filter((ref) => ref.influence !== "excluded_low_confidence");
  const slice = (influential.length ? influential : refs).slice(0, limit);
  return slice
    .map(
      (ref) =>
        `${ref.entryType}:${shortId(ref.entryId)}/${ref.influence}${ref.weight < 0.95 ? `@${Math.round(ref.weight * 100)}%` : ""}`,
    )
    .join(", ");
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
