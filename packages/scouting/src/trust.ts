import {
  classifyComparableField,
  extractTbaTeamMatchFacts,
  isComparableScoutField,
  officialValueFromTbaFacts,
  softStatboticsClimbSignal,
  type OfficialFieldPolicy as ReferenceOfficialFieldPolicy,
} from "@vantage/reference";
import type { SchemaDefinition } from "./index";

export type SchemaBudget = {
  fieldCount: number;
  recommendedMaximum: number;
  hardWarningAt: number;
  status: "healthy" | "caution" | "over_budget";
  message: string;
};

export function lintSchemaBudget(
  definition: SchemaDefinition,
  recommendedMaximum = 20,
  hardWarningAt = 25,
): SchemaBudget {
  const fieldCount = definition.fields.length;
  const status = fieldCount > hardWarningAt
    ? "over_budget"
    : fieldCount > recommendedMaximum
      ? "caution"
      : "healthy";
  return {
    fieldCount,
    recommendedMaximum,
    hardWarningAt,
    status,
    message: status === "healthy"
      ? `${fieldCount} fields — within the accuracy budget (~${recommendedMaximum}).`
      : status === "caution"
        ? `${fieldCount} fields — CD studies show more columns often mean worse accuracy; aim for ≤${recommendedMaximum}.`
        : `${fieldCount} fields — over the ~${hardWarningAt} hard warning; remove or defer at least ${fieldCount - hardWarningAt} before relying on this form.`,
  };
}

export type FieldTrustSummary = {
  fieldKey: string;
  checks: number;
  matches: number;
  conflicts: number;
  disagreementRate: number | null;
  confidenceScore: number | null;
};

export function summarizeFieldTrust(
  rows: Array<{ fieldKey: string; status: "match" | "conflict" | "unavailable" | "not_comparable" }>,
): FieldTrustSummary[] {
  const grouped = new Map<string, { checks: number; matches: number; conflicts: number }>();
  for (const row of rows) {
    const current = grouped.get(row.fieldKey) ?? { checks: 0, matches: 0, conflicts: 0 };
    if (row.status === "match" || row.status === "conflict") current.checks++;
    if (row.status === "match") current.matches++;
    if (row.status === "conflict") current.conflicts++;
    grouped.set(row.fieldKey, current);
  }
  return [...grouped.entries()].map(([fieldKey, value]) => ({
    fieldKey,
    ...value,
    disagreementRate: value.checks ? value.conflicts / value.checks : null,
    confidenceScore: value.checks ? value.matches / value.checks : null,
  })).sort((a, b) => (b.disagreementRate ?? -1) - (a.disagreementRate ?? -1));
}

export type ScoutAccuracyRow = {
  userId: string;
  name: string;
  entries: number;
  checks: number;
  matches: number;
  conflicts: number;
  accuracy: number | null;
};

/** Accuracy outranks volume; sample size only breaks equal-accuracy ties. */
export function rankScoutsByAccuracy(
  rows: Array<Omit<ScoutAccuracyRow, "accuracy"> & { accuracy?: number | null }>,
): ScoutAccuracyRow[] {
  return rows.map((row) => ({
    ...row,
    accuracy: row.accuracy ?? (row.checks ? row.matches / row.checks : null),
  })).sort((a, b) => {
    const accuracy = (b.accuracy ?? -1) - (a.accuracy ?? -1);
    if (accuracy) return accuracy;
    if (b.checks !== a.checks) return b.checks - a.checks;
    return a.name.localeCompare(b.name);
  });
}


/** Scout-facing copy for a field with enough official history. */
export function fieldConfidenceHint(
  summary: FieldTrustSummary | undefined,
  minimumChecks = 3,
): string | null {
  if (!summary || summary.checks < minimumChecks || summary.disagreementRate == null) return null;
  const pct = Math.round(summary.disagreementRate * 100);
  if (pct <= 5) {
    return `Team history: ${pct}% disagreement vs TBA across ${summary.checks} checks — usually solid.`;
  }
  if (pct < 18) {
    return `Team history: ${pct}% disagreement vs TBA across ${summary.checks} checks — double-check.`;
  }
  return `Team history: ${pct}% disagreement vs TBA across ${summary.checks} checks — slow down on this field.`;
}

export type OfficialFieldPolicy = ReferenceOfficialFieldPolicy & {
  enabled?: boolean;
};

const compact = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");

export function valuesAgree(scoutValue: unknown, officialValue: unknown): boolean {
  if (typeof scoutValue === "number" && typeof officialValue === "number") {
    return Math.abs(scoutValue - officialValue) < 0.001;
  }
  if (typeof scoutValue === "boolean") {
    const official = compact(officialValue);
    if (scoutValue) {
      return (
        ["true", "yes", "1", "on", "taxi", "mobility", "left"].includes(official) ||
        (Number.isFinite(Number(officialValue)) && Number(officialValue) > 0)
      );
    }
    return (
      ["false", "no", "0", "off", "none"].includes(official) ||
      (Number.isFinite(Number(officialValue)) && Number(officialValue) === 0)
    );
  }
  const scout = compact(scoutValue);
  const official = compact(officialValue);
  if (scout === official) return true;
  if (scout === "none" && ["notattempted", "none", "no", "park", "parked"].includes(official)) return true;
  if (["high", "traversal", "deep", "deepcage", "shallowcage", "full"].includes(scout)
    && ["high", "traversal", "deep", "deepcage", "shallowcage", "parked", "full", "stage"].some((token) => official.includes(token))) {
    return true;
  }
  if (["partial", "low", "park", "parked"].includes(scout) && ["park", "parked", "low", "shallow", "shallowcage"].some((token) => official.includes(token))) {
    return true;
  }
  if (Number.isFinite(Number(scoutValue)) && Number.isFinite(Number(officialValue))) {
    return Math.abs(Number(scoutValue) - Number(officialValue)) < 0.001;
  }
  return false;
}

export function officialValueForTeam(input: {
  fieldKey: string;
  policy?: OfficialFieldPolicy;
  teamKey: string;
  redAlliance: { teamKeys?: string[] };
  blueAlliance: { teamKeys?: string[] };
  scoreBreakdown: Record<string, unknown> | null;
}): { value: unknown; officialKey: string } | null {
  const facts = extractTbaTeamMatchFacts(
    {
      matchKey: "",
      redAlliance: input.redAlliance,
      blueAlliance: input.blueAlliance,
      scoreBreakdown: input.scoreBreakdown,
    },
    input.teamKey,
  );
  if (!facts || !input.scoreBreakdown) return null;
  const resolved = officialValueFromTbaFacts({
    fieldKey: input.fieldKey,
    policy: input.policy,
    facts,
    scoreBreakdown: input.scoreBreakdown,
  });
  return resolved ? { value: resolved.value, officialKey: resolved.officialKey } : null;
}

export type FieldValidationStatus = "match" | "conflict" | "unavailable" | "not_comparable";

export type FieldValidation = {
  fieldKey: string;
  status: FieldValidationStatus;
  scoutValue: unknown;
  officialValue: unknown | null;
  officialSource: "tba" | "statbotics";
  officialKey: string | null;
  detail: string;
  soft?: boolean;
};

export function crossValidateScoutPayload(input: {
  payload: Record<string, unknown>;
  fieldKeys: string[];
  teamKey: string;
  redAlliance: { teamKeys?: string[] };
  blueAlliance: { teamKeys?: string[] };
  scoreBreakdown: Record<string, unknown> | null;
  policies?: OfficialFieldPolicy[];
  epaEndgame?: number | null;
}): FieldValidation[] {
  const policyByField = new Map((input.policies ?? []).map((policy) => [policy.fieldKey, policy]));
  const results: FieldValidation[] = [];
  const facts = extractTbaTeamMatchFacts(
    {
      matchKey: "",
      redAlliance: input.redAlliance,
      blueAlliance: input.blueAlliance,
      scoreBreakdown: input.scoreBreakdown,
    },
    input.teamKey,
  );

  for (const fieldKey of input.fieldKeys) {
    if (!Object.prototype.hasOwnProperty.call(input.payload, fieldKey)) continue;
    if (!isComparableScoutField(fieldKey)) continue;
    const policy = policyByField.get(fieldKey);
    if (policy?.enabled === false) continue;
    const scoutValue = input.payload[fieldKey];

    if (!input.scoreBreakdown) {
      results.push({
        fieldKey,
        status: "unavailable",
        scoutValue,
        officialValue: null,
        officialSource: "tba",
        officialKey: null,
        detail: "Official TBA score breakdown is not cached yet for this match.",
      });
      continue;
    }

    if (!facts) {
      results.push({
        fieldKey,
        status: "not_comparable",
        scoutValue,
        officialValue: null,
        officialSource: "tba",
        officialKey: null,
        detail: "Team is not on this match alliance in the cached schedule.",
      });
      continue;
    }

    const reference = officialValueFromTbaFacts({
      fieldKey,
      policy,
      facts,
      scoreBreakdown: input.scoreBreakdown,
    });

    if (!reference) {
      results.push({
        fieldKey,
        status: "unavailable",
        scoutValue,
        officialValue: null,
        officialSource: "tba",
        officialKey: null,
        detail: `No TBA ${classifyComparableField(fieldKey)} key present in score breakdown yet.`,
      });
      continue;
    }

    const status = valuesAgree(scoutValue, reference.value) ? "match" : "conflict";
    results.push({
      fieldKey,
      status,
      scoutValue,
      officialValue: reference.value,
      officialSource: "tba",
      officialKey: reference.officialKey,
      detail:
        status === "match"
          ? `Matches TBA score_breakdown.${reference.officialKey}`
          : `Conflicts with TBA score_breakdown.${reference.officialKey}`,
    });

    if (classifyComparableField(fieldKey) === "climb") {
      const soft = softStatboticsClimbSignal({
        scoutClimb: scoutValue,
        epaEndgame: input.epaEndgame,
      });
      if (soft?.softNote) {
        results.push({
          fieldKey,
          status: "not_comparable",
          scoutValue,
          officialValue: soft.epaEndgame,
          officialSource: "statbotics",
          officialKey: "epa_endgame",
          detail: soft.softNote,
          soft: true,
        });
      }
    }
  }

  return results;
}

export type CoverageCell = { matchKey: string; teamKey: string; assignmentCount: number; entryCount: number };
export type CoverageState = "missing" | "assigned" | "covered" | "double_covered";
export type CoverageBoardCell = CoverageCell & {
  matchNumber: number;
  compLevel: string;
  state: CoverageState;
};

export function coverageState(cell: CoverageCell): CoverageState {
  if (cell.entryCount > 1) return "double_covered";
  if (cell.entryCount === 1) return "covered";
  if (cell.assignmentCount > 0) return "assigned";
  return "missing";
}

/** Build per-robot cells for a match list (Event Day / trust board). */
export function buildCoverageBoard(input: {
  matches: Array<{ matchKey: string; matchNumber: number; compLevel: string; teamKeys: string[] }>;
  assignmentCounts?: Map<string, number> | Record<string, number>;
  entryCounts?: Map<string, number> | Record<string, number>;
}): CoverageBoardCell[] {
  const assignments = toCountMap(input.assignmentCounts);
  const entries = toCountMap(input.entryCounts);
  return input.matches.flatMap((match) =>
    match.teamKeys.map((teamKey) => {
      const key = `${match.matchKey}|${teamKey}`;
      const cell: CoverageCell = {
        matchKey: match.matchKey,
        teamKey,
        assignmentCount: assignments.get(key) ?? 0,
        entryCount: entries.get(key) ?? 0,
      };
      return {
        ...cell,
        matchNumber: match.matchNumber,
        compLevel: match.compLevel,
        state: coverageState(cell),
      };
    }),
  );
}

export function summarizeCoverageBoard(cells: Array<{ state: CoverageState }>) {
  let missing = 0;
  let assigned = 0;
  let covered = 0;
  let doubleCovered = 0;
  for (const cell of cells) {
    if (cell.state === "missing") missing += 1;
    else if (cell.state === "assigned") assigned += 1;
    else if (cell.state === "covered") covered += 1;
    else doubleCovered += 1;
  }
  return { missing, assigned, covered, doubleCovered, total: cells.length };
}

/** Stable key so mid-event nudges do not re-fire for the same uncovered rows. */
export function coverageGapFingerprint(cells: Array<{ matchKey: string; teamKey: string; state?: CoverageState }>): string {
  return cells
    .filter((cell) => !cell.state || cell.state === "missing")
    .map((cell) => `${cell.matchKey}:${cell.teamKey}`)
    .sort()
    .join("|");
}

export function coverageGapMessage(input: {
  eventKey: string;
  missing: number;
  sample?: Array<{ matchKey: string; teamKey: string; matchNumber?: number; compLevel?: string }>;
}): string {
  const sample = (input.sample ?? [])
    .slice(0, 3)
    .map((row) => {
      const team = row.teamKey.replace(/^frc/i, "");
      const match =
        row.compLevel && row.matchNumber != null
          ? `${row.compLevel.toUpperCase()} ${row.matchNumber}`
          : row.matchKey;
      return `${match} · ${team}`;
    })
    .join("; ");
  const head =
    input.missing === 1
      ? `1 scouting row is uncovered at ${input.eventKey}`
      : `${input.missing} scouting rows are uncovered at ${input.eventKey}`;
  return sample ? `${head}: ${sample}.` : `${head}.`;
}

function toCountMap(value?: Map<string, number> | Record<string, number>): Map<string, number> {
  if (!value) return new Map();
  if (value instanceof Map) return value;
  return new Map(Object.entries(value).map(([key, count]) => [key, Number(count) || 0]));
}

export function epaDrift(input: { seasonEpa: number | null; recentScores: number[]; threshold?: number }) {
  const recent = input.recentScores.filter(Number.isFinite).slice(-3);
  if (input.seasonEpa == null || recent.length < 2) return null;
  const recentAverage = recent.reduce((sum, value) => sum + value, 0) / recent.length;
  const delta = recentAverage - input.seasonEpa;
  const threshold = input.threshold ?? Math.max(5, Math.abs(input.seasonEpa) * 0.15);
  return { recentAverage, delta, divergent: Math.abs(delta) >= threshold };
}

export function fatigueAwareAssignments(input: {
  scouts: string[];
  matches: Array<{ matchKey: string; teamKeys: string[] }>;
  maximumConsecutiveMatches?: number;
}) {
  const cap = Math.max(1, Math.trunc(input.maximumConsecutiveMatches ?? 3));
  if (!input.scouts.length) return { assignments: [], underCovered: input.matches.map((match) => match.matchKey) };
  const consecutive = new Map(input.scouts.map((scout) => [scout, 0]));
  const assignments: Array<{ matchKey: string; teamKey: string; userId: string; fatigueWarning: boolean }> = [];
  const underCovered: string[] = [];
  for (let matchIndex = 0; matchIndex < input.matches.length; matchIndex++) {
    const match = input.matches[matchIndex]!;
    const used = new Set<string>();
    for (const teamKey of match.teamKeys) {
      const eligible = input.scouts
        .filter((scout) => !used.has(scout))
        .sort((a, b) => (consecutive.get(a) ?? 0) - (consecutive.get(b) ?? 0));
      const scout = eligible.find((candidate) => (consecutive.get(candidate) ?? 0) < cap) ?? eligible[0];
      if (!scout) { underCovered.push(match.matchKey); continue; }
      const count = (consecutive.get(scout) ?? 0) + 1;
      consecutive.set(scout, count);
      used.add(scout);
      assignments.push({ matchKey: match.matchKey, teamKey, userId: scout, fatigueWarning: count >= cap });
    }
    for (const scout of input.scouts) if (!used.has(scout)) consecutive.set(scout, 0);
    if (used.size < match.teamKeys.length && !underCovered.includes(match.matchKey)) underCovered.push(match.matchKey);
  }
  return { assignments, underCovered };
}

export type ScoutConfidence = "high" | "normal" | "low";

export type ResolutionConfidenceAdjustment = {
  entryId: string;
  confidence: ScoutConfidence;
  reason: "winning_resolution" | "losing_resolution";
};

/**
 * After a coach picks which scout was right, promote the winning entry and
 * down-weight the losing ones so pick-desk / strategy stop averaging them equally.
 */
export function confidenceAdjustmentsForResolution(input: {
  entryIds: string[];
  winningEntryId: string | null | undefined;
  status: "resolved" | "dismissed" | "open";
}): ResolutionConfidenceAdjustment[] {
  if (input.status !== "resolved") return [];
  const winningEntryId = typeof input.winningEntryId === "string" ? input.winningEntryId.trim() : "";
  if (!winningEntryId || !input.entryIds.includes(winningEntryId)) return [];
  return input.entryIds.map((entryId) =>
    entryId === winningEntryId
      ? { entryId, confidence: "high" as const, reason: "winning_resolution" as const }
      : { entryId, confidence: "low" as const, reason: "losing_resolution" as const },
  );
}

/** Prefer non-low-confidence observations for strategy metrics; keep all if every row is low. */
export function observationsForStrategyTrust<T extends { confidence: ScoutConfidence }>(
  observations: T[],
): T[] {
  const usable = observations.filter((row) => row.confidence !== "low");
  return usable.length ? usable : observations;
}

export function confidenceWeight(confidence: ScoutConfidence): number {
  if (confidence === "high") return 1;
  if (confidence === "low") return 0.35;
  return 0.85;
}

export type PickInfluenceCandidate = {
  id: string;
  teamKey: string;
  scoutUserId: string;
  confidence: ScoutConfidence;
  updatedAt: string;
};

export type PickListTeamRef = {
  teamKey: string;
  rank: number;
  tier?: string | null;
};

/** After alliance picks, attribute the strongest non-low scout rows that fed each listed team. */
export function selectPickInfluencingEntries(input: {
  pickTeams: PickListTeamRef[];
  entries: PickInfluenceCandidate[];
  maxPerTeam?: number;
  listName?: string;
}): Array<{ entryId: string; teamKey: string; scoutUserId: string; reason: string }> {
  const maxPerTeam = Math.max(1, Math.min(5, Math.trunc(input.maxPerTeam ?? 3)));
  const listLabel = input.listName?.trim() || "pick list";
  const results: Array<{ entryId: string; teamKey: string; scoutUserId: string; reason: string }> = [];
  for (const team of input.pickTeams) {
    const tier = (team.tier ?? "watch").trim() || "watch";
    const chosen = input.entries
      .filter((entry) => entry.teamKey === team.teamKey && entry.confidence !== "low")
      .sort((a, b) => {
        const conf = (value: ScoutConfidence) => (value === "high" ? 0 : 1);
        if (conf(a.confidence) !== conf(b.confidence)) return conf(a.confidence) - conf(b.confidence);
        return b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, maxPerTeam);
    for (const entry of chosen) {
      results.push({
        entryId: entry.id,
        teamKey: team.teamKey,
        scoutUserId: entry.scoutUserId,
        reason: `Your ${entry.confidence} scout of ${team.teamKey} informed ${tier} pick #${team.rank} on ${listLabel}.`,
      });
    }
  }
  return results;
}

/** Rotate top TBA-validated scouts into the pick-desk conversation. */
export function rankScoutsForStrategySeats(input: {
  scouts: Array<{
    userId: string;
    checks: number;
    matches: number;
    entries: number;
    name?: string;
    conflicts?: number;
  }>;
  seatCount?: number;
  minChecks?: number;
}): Array<{ userId: string; accuracy: number; reason: string }> {
  const seatCount = Math.max(1, Math.min(8, Math.trunc(input.seatCount ?? 3)));
  const minChecks = Math.max(1, Math.trunc(input.minChecks ?? 1));
  return rankScoutsByAccuracy(
    input.scouts
      .filter((scout) => scout.checks >= minChecks)
      .map((scout) => ({
        userId: scout.userId,
        name: scout.name ?? scout.userId,
        entries: scout.entries,
        checks: scout.checks,
        matches: scout.matches,
        conflicts: scout.conflicts ?? Math.max(0, scout.checks - scout.matches),
      })),
  )
    .filter((scout): scout is ScoutAccuracyRow & { accuracy: number } => scout.accuracy != null)
    .slice(0, seatCount)
    .map((scout) => ({
      userId: scout.userId,
      accuracy: scout.accuracy,
      reason: `Top accuracy ${Math.round(scout.accuracy * 100)}% (${scout.matches}/${scout.checks} vs TBA)`,
    }));
}

/** Per-field TBA/Statbotics check attached to a scout entry (Neon scout_entry_validations). */
export type ScoutFieldValidation = {
  entryId: string;
  fieldKey: string;
  status: FieldValidationStatus;
  scoutValue?: unknown;
  officialValue?: unknown;
  officialSource?: string;
  detail?: string;
};

/**
 * Drop contradicted scout fields so strategy / pick-desk / assistant tools never
 * treat TBA-disputed climb/mobility/foul values as trusted observations.
 */
export function stripContradictedFields(
  payload: Record<string, unknown>,
  validations: Array<Pick<ScoutFieldValidation, "fieldKey" | "status">>,
): { trustedPayload: Record<string, unknown>; excludedFields: string[] } {
  const conflictKeys = new Set(
    validations.filter((row) => row.status === "conflict").map((row) => row.fieldKey),
  );
  if (!conflictKeys.size) return { trustedPayload: { ...payload }, excludedFields: [] };
  const trustedPayload: Record<string, unknown> = {};
  const excludedFields: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (conflictKeys.has(key)) {
      excludedFields.push(key);
      continue;
    }
    trustedPayload[key] = value;
  }
  return { trustedPayload, excludedFields: excludedFields.sort() };
}

/** Compact provenance rows for AI tool / UI surfaces. */
export function formatValidationProvenance(
  validations: ScoutFieldValidation[],
  limit = 12,
): Array<{
  entryId: string;
  fieldKey: string;
  status: FieldValidationStatus;
  officialSource: string;
  detail: string;
  scoutValue: unknown;
  officialValue: unknown;
}> {
  return validations
    .filter((row) => row.status === "conflict" || row.status === "match")
    .slice(0, limit)
    .map((row) => ({
      entryId: row.entryId,
      fieldKey: row.fieldKey,
      status: row.status,
      officialSource: row.officialSource ?? "tba",
      detail: row.detail ?? "",
      scoutValue: row.scoutValue ?? null,
      officialValue: row.officialValue ?? null,
    }));
}

export function conflictCountByTeam(
  rows: Array<{ teamKey: string; status: FieldValidationStatus; fieldKey: string }>,
): Map<string, { conflictCount: number; conflictFields: string[] }> {
  const map = new Map<string, { conflictCount: number; conflictFields: Set<string> }>();
  for (const row of rows) {
    if (row.status !== "conflict") continue;
    const current = map.get(row.teamKey) ?? { conflictCount: 0, conflictFields: new Set<string>() };
    current.conflictCount += 1;
    current.conflictFields.add(row.fieldKey);
    map.set(row.teamKey, current);
  }
  return new Map(
    [...map.entries()].map(([teamKey, value]) => [
      teamKey,
      { conflictCount: value.conflictCount, conflictFields: [...value.conflictFields].sort() },
    ]),
  );
}
