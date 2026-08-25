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
  source?: "manual" | "voice" | "import" | "video";
  videoReviewId?: string | null;
  videoAtSeconds?: number | null;
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
  | "excluded_low_confidence"
  | "video_rescore"
  /** Field stripped because TBA/Statbotics official result contradicted the scout value. */
  | "tba_conflict_excluded";

export type ScoutProvenanceRef = {
  entryId: string;
  entryType: ScoutEntryKind;
  teamKey: string;
  matchKey?: string | null;
  scoutUserId?: string | null;
  influence: ScoutInfluence;
  weight: number;
  source?: "manual" | "voice" | "import" | "video";
  videoReviewId?: string | null;
  videoAtSeconds?: number | null;
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
  videoRescoutCount?: number;
  videoReviewIds?: string[];
};

/**
 * Explicit strategy mapping a form-builder question can declare (persisted as
 * `field.config.role` on published scout schemas). Resolution ladder per signal:
 *   1. payload keys whose schema field declares the matching role,
 *   2. the legacy camelCase convention keys (exact),
 *   3. a case/underscore-insensitive normalization of the same names
 *      (autoScore == auto_score == "Auto Score" slug).
 * `"none"` opts a field out of convention fallbacks entirely.
 */
export const STRATEGY_FIELD_ROLES = [
  "none",
  "auto_score",
  "teleop_score",
  "endgame",
  "defense",
  "fouls",
  "notes",
] as const;

export type StrategyFieldRole = (typeof STRATEGY_FIELD_ROLES)[number];

/** Payload/schema field key → declared strategy role. */
export type ScoutFieldRoleMap = Record<string, StrategyFieldRole>;

export type ScoutSignalOptions = {
  /** From the org's published scout schemas — see fieldRolesFromSchemaDefinitions. */
  roles?: ScoutFieldRoleMap;
};

export function isStrategyFieldRole(value: unknown): value is StrategyFieldRole {
  return (
    typeof value === "string" &&
    (STRATEGY_FIELD_ROLES as readonly string[]).includes(value)
  );
}

/** Compare payload keys ignoring case and separators: autoScore == auto_score. */
export function normalizeSignalKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

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

/**
 * Infer a default role from a schema field key so the DEFAULT match/pit schemas
 * (auto_score, teleop_fuel, endgame, notes, …) reach strategy without any
 * builder configuration. Explicit `config.role` always wins over this.
 */
export function inferRoleForFieldKey(key: string): StrategyFieldRole {
  const norm = normalizeSignalKey(key);
  if (!norm) return "none";
  if (norm.startsWith("auto")) return "auto_score";
  if (norm.startsWith("teleop")) return "teleop_score";
  if (norm.includes("endgame") || norm.includes("climb") || norm === "park") return "endgame";
  if (norm.includes("defense") || norm.includes("defence")) return "defense";
  if (norm.includes("foul") || norm.includes("penalt")) return "fouls";
  if (norm.includes("note") || norm.includes("comment") || norm.includes("observation")) {
    return "notes";
  }
  return "none";
}

type LooseSchemaDefinition =
  | { fields?: Array<{ key?: unknown; config?: unknown } | null> | null }
  | null
  | undefined;

/**
 * Build the payload-key → role map from published schema definitions
 * (match first, then pit). Explicit `config.role` wins — including an explicit
 * `"none"` opt-out; fields without one fall back to key inference so stored
 * schemas published before roles existed keep working.
 */
export function fieldRolesFromSchemaDefinitions(
  definitions: LooseSchemaDefinition[],
): ScoutFieldRoleMap {
  const roles: ScoutFieldRoleMap = {};
  for (const definition of definitions) {
    for (const field of definition?.fields ?? []) {
      if (!field || typeof field.key !== "string" || !field.key) continue;
      if (field.key in roles) continue;
      const configured = (field.config as { role?: unknown } | null | undefined)?.role;
      const role = isStrategyFieldRole(configured)
        ? configured
        : inferRoleForFieldKey(field.key);
      if (role !== "none" || configured === "none") roles[field.key] = role;
    }
  }
  return roles;
}

/** Generic endgame answer words (default schema options) → 0..1 signal. */
const ENDGAME_TEXT_SIGNALS: Record<string, number> = {
  none: 0,
  no: 0,
  fail: 0,
  failed: 0,
  partial: 0.5,
  park: 0.5,
  parked: 0.5,
  attempt: 0.5,
  attempted: 0.5,
  full: 1,
  climb: 1,
  climbed: 1,
  hang: 1,
  hung: 1,
  success: 1,
  yes: 1,
};

function coerceSignalValue(value: unknown, categorical: boolean): number | null {
  if (finite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    if (categorical) {
      const mapped = ENDGAME_TEXT_SIGNALS[value.trim().toLowerCase()];
      if (mapped != null) return mapped;
    }
  }
  return null;
}

/**
 * Resolution ladder: schema role → legacy exact camelCase keys →
 * normalized (snake_case / case-insensitive) match of the same names.
 * Fields explicitly opted out (role "none") never feed convention fallbacks.
 */
function resolveSignal(
  payload: Record<string, unknown>,
  legacyKeys: readonly string[],
  role: StrategyFieldRole | null,
  roles: ScoutFieldRoleMap | undefined,
  categorical = false,
): number | null {
  if (role && roles) {
    for (const [key, mapped] of Object.entries(roles)) {
      if (mapped !== role || !(key in payload)) continue;
      const value = coerceSignalValue(payload[key], categorical);
      if (value != null) return value;
    }
  }
  const optedOut = (key: string) => roles?.[key] === "none";
  for (const key of legacyKeys) {
    if (optedOut(key)) continue;
    const value = coerceSignalValue(payload[key], categorical);
    if (value != null) return value;
  }
  const normalized = new Map<string, unknown>();
  for (const key of Object.keys(payload)) {
    if (optedOut(key)) continue;
    const norm = normalizeSignalKey(key);
    if (!normalized.has(norm)) normalized.set(norm, payload[key]);
  }
  for (const key of legacyKeys) {
    const value = coerceSignalValue(normalized.get(normalizeSignalKey(key)), categorical);
    if (value != null) return value;
  }
  return null;
}

function truthySignal(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value > 0;
  if (typeof value === "string") {
    const norm = value.trim().toLowerCase();
    return norm !== "" && !["no", "false", "none", "0", "n/a"].includes(norm);
  }
  return false;
}

/** Robot-failure flag across exact and normalized key spellings (noShow == no_show). */
function anyFailureFlag(payload: Record<string, unknown>, roles?: ScoutFieldRoleMap): boolean {
  const failureNorms = new Set(["disabled", "breakdown", "noshow", "brokedown"]);
  for (const [key, value] of Object.entries(payload)) {
    if (roles?.[key] === "none") continue;
    if (failureNorms.has(normalizeSignalKey(key)) && truthySignal(value)) return true;
  }
  return false;
}

/** Defense signal: declared role first, then defense-named keys, then payload text. */
function defenseSignal(payload: Record<string, unknown>, roles?: ScoutFieldRoleMap): boolean {
  for (const [key, value] of Object.entries(payload)) {
    if (roles?.[key] === "none") continue;
    if (!truthySignal(value)) continue;
    if (roles?.[key] === "defense") return true;
    if (/defen[cs]e/.test(normalizeSignalKey(key))) return true;
  }
  const text = JSON.stringify(payload).toLowerCase();
  return /\bdefen[cs]e\b/.test(text) || payload.defense === true || payload.playedDefense === true;
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
export function extractNotes(
  payload: Record<string, unknown>,
  roles?: ScoutFieldRoleMap,
): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string" || value.trim().length < 3) return;
    const trimmed = value.trim().slice(0, 280);
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    notes.push(trimmed);
  };
  if (roles) {
    for (const [key, role] of Object.entries(roles)) {
      if (role === "notes" && key in payload) push(payload[key]);
    }
  }
  for (const key of NOTE_KEYS) {
    if (roles?.[key] === "none") continue;
    push(payload[key]);
  }
  const noteNorms = new Set(NOTE_KEYS.map(normalizeSignalKey));
  for (const [key, value] of Object.entries(payload)) {
    if (roles?.[key]) continue; // role-mapped or opted out above
    const norm = normalizeSignalKey(key);
    if (noteNorms.has(norm) || norm.endsWith("notes") || norm.endsWith("comments")) {
      push(value);
    }
  }
  return notes;
}

export function deriveScoutCapabilities(
  observations: Array<{ payload: Record<string, unknown>; weight?: number }>,
  options?: ScoutSignalOptions,
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

  const roles = options?.roles;
  const weightedMean = (
    keys: readonly string[],
    role: StrategyFieldRole | null,
    categorical = false,
  ) => {
    let sum = 0;
    let weightSum = 0;
    for (const obs of observations) {
      const value = resolveSignal(obs.payload, keys, role, roles, categorical);
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

  const autoRate = weightedMean(AUTO_KEYS, "auto_score");
  const teleopRate = weightedMean(TELEOP_KEYS, "teleop_score");
  const endgameRate = weightedMean(ENDGAME_KEYS, "endgame", true);
  const defenseLikely = observations.some(({ payload }) => defenseSignal(payload, roles));

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
export function computeScoutQuality(
  entries: ScoutEntryRecord[],
  options?: ScoutSignalOptions,
): ScoutQualityReport {
  const matchEntries = entries.filter((entry) => entry.entryType === "match");
  const scored = matchEntries
    .map((entry) => ({
      entry,
      score: resolveSignal(entry.payload, SCORE_KEYS, null, options?.roles),
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
    const rawAnomaly = scoutWeightById.get(scoutId) ?? 1;
    const anomaly =
      entry.source === "video"
        ? clamp(rawAnomaly + (1 - rawAnomaly) * 0.35, rawAnomaly, 1)
        : rawAnomaly;
    let weight = clamp(confidenceBaseWeight(entry.confidence) * anomaly, 0.2, 1);
    if (entry.source === "video") weight = clamp(weight * 1.12, 0.2, 1);
    byEntryId[entry.id] = weight;
    weightSum += weight;
  }

  const meanWeight = entries.length ? weightSum / entries.length : 1;
  const videoRescoutCount = entries.filter((entry) => entry.source === "video").length;
  const transparency = scoutReports
    .filter((report) => report.weight < 0.95)
    .map(
      (report) =>
        `Scout ${shortId(report.scoutUserId)} downweighted to ${Math.round(report.weight * 100)}%: ${report.reason}`,
    );

  if (videoRescoutCount > 0) {
    transparency.unshift(
      `${videoRescoutCount} video-rescored ${videoRescoutCount === 1 ? "entry" : "entries"} weighted +12% with softened anomaly checks.`,
    );
  }

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
  role: StrategyFieldRole | null = null,
  roles?: ScoutFieldRoleMap,
) {
  let sum = 0;
  let wSum = 0;
  let count = 0;
  for (const obs of observations) {
    const value = resolveSignal(obs.payload, keys, role, roles);
    if (value == null) continue;
    const w = weights[obs.id] ?? 1;
    sum += value * w;
    wSum += w;
    count += 1;
  }
  if (count < minSamples || !wSum) return null;
  return sum / wSum;
}

function weightedReliability(
  observations: ScoutEntryRecord[],
  weights: Record<string, number>,
  roles?: ScoutFieldRoleMap,
) {
  if (!observations.length) return null;
  let failureWeight = 0;
  let totalWeight = 0;
  for (const obs of observations) {
    const w = weights[obs.id] ?? 1;
    totalWeight += w;
    if (anyFailureFlag(obs.payload, roles)) failureWeight += w;
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
  options?: ScoutSignalOptions,
): BuiltOperationalSignal | null {
  const teamEntries = entries.filter((entry) => entry.teamKey === teamKey);
  if (!teamEntries.length) return null;

  const roles = options?.roles;
  const quality = computeScoutQuality(teamEntries, options);
  const matchEntries = teamEntries.filter((entry) => entry.entryType === "match");
  const pitEntries = teamEntries.filter((entry) => entry.entryType === "pit");

  const usableMatch = matchEntries.filter((entry) => entry.confidence !== "low");
  const excludedLow = matchEntries.filter((entry) => entry.confidence === "low");

  const reliability = weightedReliability(usableMatch, quality.byEntryId, roles);
  const foulRate = weightedRate(usableMatch, quality.byEntryId, FOUL_KEYS, 3, "fouls", roles);
  const capabilities = deriveScoutCapabilities(
    [...usableMatch, ...pitEntries.filter((entry) => entry.confidence !== "low")].map((entry) => ({
      payload: entry.payload,
      weight: quality.byEntryId[entry.id] ?? 1,
    })),
    options,
  );

  const pitNotes = pitEntries.flatMap((entry) => extractNotes(entry.payload, roles)).slice(0, 6);
  // Fall back to match notes when pit is empty
  const matchNotes =
    pitNotes.length === 0
      ? usableMatch.flatMap((entry) => extractNotes(entry.payload, roles)).slice(0, 4)
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
      source: entry.source,
      videoReviewId: entry.videoReviewId ?? null,
      videoAtSeconds: entry.videoAtSeconds ?? null,
    });
  };

  const videoEntries = teamEntries.filter((entry) => entry.source === "video");
  for (const entry of videoEntries) {
    pushProv(entry, "video_rescore");
  }

  for (const entry of usableMatch) {
    if (reliability != null) pushProv(entry, "reliability");
    if (foulRate != null && resolveSignal(entry.payload, FOUL_KEYS, "fouls", roles) != null) {
      pushProv(entry, "foul_rate");
    }
    if (resolveSignal(entry.payload, AUTO_KEYS, "auto_score", roles) != null) {
      pushProv(entry, "auto_capability");
    }
    if (resolveSignal(entry.payload, TELEOP_KEYS, "teleop_score", roles) != null) {
      pushProv(entry, "teleop_capability");
    }
    if (resolveSignal(entry.payload, ENDGAME_KEYS, "endgame", roles, true) != null) {
      pushProv(entry, "endgame_capability");
    }
    if (defenseSignal(entry.payload, roles)) {
      pushProv(entry, "defense");
    }
  }
  for (const entry of pitEntries) {
    if (extractNotes(entry.payload, roles).length) pushProv(entry, "pit_note");
    if (defenseSignal(entry.payload, roles)) {
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
  const videoReviewIds = [
    ...new Set(videoEntries.map((entry) => entry.videoReviewId).filter((id): id is string => Boolean(id))),
  ];

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
    videoRescoutCount: videoEntries.length || undefined,
    videoReviewIds: videoReviewIds.length ? videoReviewIds : undefined,
  };
}

export function buildOperationsFromScoutEntries(
  entries: ScoutEntryRecord[],
  options?: ScoutSignalOptions,
) {
  const teamKeys = [...new Set(entries.map((entry) => entry.teamKey))];
  const operations: BuiltOperationalSignal[] = [];
  for (const teamKey of teamKeys) {
    const built = buildTeamOperationalSignal(teamKey, entries, options);
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
    .map((ref) => {
      const prefix = ref.source === "video" ? "video:" : "";
      return `${prefix}${ref.entryType}:${shortId(ref.entryId)}/${ref.influence}${ref.weight < 0.95 ? `@${Math.round(ref.weight * 100)}%` : ""}`;
    })
    .join(", ");
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
