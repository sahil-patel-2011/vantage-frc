// Pure, unit-testable helpers for scout cross-validation. No I/O, no framework imports.

import type {
  CrossvalAlliance,
  CrossvalEntry,
  CrossvalFieldCheck,
  CrossvalFieldKey,
  CrossvalStatus,
  CrossvalSummary,
} from "./types";

/** Aliases a scout payload may use for a given comparable field. */
const CROSSVAL_FIELD_ALIASES: Record<CrossvalFieldKey, string[]> = {
  autoPoints: ["autoPoints", "auto_points", "autoScore"],
  teleopPoints: ["teleopPoints", "teleop_points", "teleopScore"],
  endgamePoints: ["endgamePoints", "endgame_points", "endgameScore"],
  totalPoints: ["totalPoints", "total_points", "totalScore", "points"],
};

const CROSSVAL_FIELD_LABELS: Record<CrossvalFieldKey, string> = {
  autoPoints: "Auto points",
  teleopPoints: "Teleop points",
  endgamePoints: "Endgame points",
  totalPoints: "Total points",
};

export const CROSSVAL_FIELD_KEYS: CrossvalFieldKey[] = [
  "autoPoints",
  "teleopPoints",
  "endgamePoints",
  "totalPoints",
];

/** A field agrees when within this fraction (or this many absolute points) of the official value. */
const AGREEMENT_TOLERANCE_PCT = 0.1;
const AGREEMENT_TOLERANCE_ABS = 4;

type AllianceValue = { team_keys?: string[] } | string[] | null | undefined;

export function teamKeysFromAlliance(value: AllianceValue): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (value && Array.isArray(value.team_keys)) {
    return value.team_keys.filter((v): v is string => typeof v === "string");
  }
  return [];
}

export function resolveAllianceColor(
  teamKey: string,
  redAlliance: AllianceValue,
  blueAlliance: AllianceValue,
): CrossvalAlliance | null {
  if (teamKeysFromAlliance(redAlliance).includes(teamKey)) return "red";
  if (teamKeysFromAlliance(blueAlliance).includes(teamKey)) return "blue";
  return null;
}

function numberFromPayload(payload: Record<string, unknown> | null | undefined, aliases: string[]): number | null {
  if (!payload) return null;
  for (const key of aliases) {
    const raw = payload[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}

function numberFromBreakdown(
  breakdown: Record<string, unknown> | null | undefined,
  allianceColor: CrossvalAlliance | null,
  fieldKey: CrossvalFieldKey,
): number | null {
  if (!breakdown || !allianceColor) return null;
  const alliance = breakdown[allianceColor];
  if (!alliance || typeof alliance !== "object") return null;
  const aliasList = CROSSVAL_FIELD_ALIASES[fieldKey];
  for (const key of aliasList) {
    const raw = (alliance as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
  }
  return null;
}

function compareField(
  fieldKey: CrossvalFieldKey,
  scoutValue: number | null,
  officialValue: number | null,
): CrossvalFieldCheck {
  if (scoutValue == null || officialValue == null) {
    return {
      fieldKey,
      fieldLabel: CROSSVAL_FIELD_LABELS[fieldKey],
      scoutValue,
      officialValue,
      status: "unverifiable",
      deltaAbs: null,
      deltaPct: null,
    };
  }
  const deltaAbs = Math.abs(scoutValue - officialValue);
  const deltaPct = officialValue !== 0 ? deltaAbs / Math.abs(officialValue) : deltaAbs > 0 ? 1 : 0;
  const agrees = deltaAbs <= AGREEMENT_TOLERANCE_ABS || deltaPct <= AGREEMENT_TOLERANCE_PCT;
  return {
    fieldKey,
    fieldLabel: CROSSVAL_FIELD_LABELS[fieldKey],
    scoutValue,
    officialValue,
    status: agrees ? "agree" : "conflict",
    deltaAbs,
    deltaPct,
  };
}

/**
 * Computes per-field agree/conflict/unverifiable checks for one scout entry against the cached
 * official score breakdown for its match/alliance. Pure — takes already-fetched payload/breakdown.
 */
export function computeFieldChecks(input: {
  payload: Record<string, unknown> | null | undefined;
  scoreBreakdown: Record<string, unknown> | null | undefined;
  allianceColor: CrossvalAlliance | null;
}): CrossvalFieldCheck[] {
  return CROSSVAL_FIELD_KEYS.map((fieldKey) => {
    const scoutValue = numberFromPayload(input.payload, CROSSVAL_FIELD_ALIASES[fieldKey]);
    const officialValue = numberFromBreakdown(input.scoreBreakdown, input.allianceColor, fieldKey);
    return compareField(fieldKey, scoutValue, officialValue);
  });
}

export function overallStatusFromFields(fields: CrossvalFieldCheck[]): {
  overallStatus: CrossvalStatus;
  agreeCount: number;
  conflictCount: number;
  unverifiableCount: number;
} {
  const agreeCount = fields.filter((f) => f.status === "agree").length;
  const conflictCount = fields.filter((f) => f.status === "conflict").length;
  const unverifiableCount = fields.filter((f) => f.status === "unverifiable").length;
  const overallStatus: CrossvalStatus =
    conflictCount > 0 ? "conflict" : agreeCount > 0 ? "agree" : "unverifiable";
  return { overallStatus, agreeCount, conflictCount, unverifiableCount };
}

export function summarizeCrossval(entries: CrossvalEntry[]): CrossvalSummary {
  const totalEntries = entries.length;
  const agreeEntries = entries.filter((e) => e.overallStatus === "agree").length;
  const conflictEntries = entries.filter((e) => e.overallStatus === "conflict").length;
  const unverifiableEntries = entries.filter((e) => e.overallStatus === "unverifiable").length;
  const verifiable = agreeEntries + conflictEntries;
  const agreementRate = verifiable > 0 ? agreeEntries / verifiable : 0;
  return { totalEntries, agreeEntries, conflictEntries, unverifiableEntries, agreementRate };
}

export function crossvalStatusLabel(status: CrossvalStatus): string {
  if (status === "agree") return "Agrees with official";
  if (status === "conflict") return "Conflicts with official";
  return "Unverifiable";
}
