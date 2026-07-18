/** Structured "which scout was right" resolution for scout_disagreements. */

export type ResolutionOutcome = "chose_scout" | "dismissed";

export type DisagreementResolution = {
  outcome: ResolutionOutcome;
  winningEntryId?: string;
  winningScoutUserId?: string;
  winningScoutName?: string;
  chosenValue?: unknown;
  note?: string;
  reviewedIn: "scouting-ui" | "api";
};

export type DisagreementCandidate = {
  entryId: string;
  scoutUserId: string;
  scoutName: string;
  value: unknown;
};

export type AuditAction = "resolved" | "dismissed" | "reopened";

export function formatConflictValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function buildChoseScoutResolution(input: {
  entryId: string;
  scoutUserId: string;
  scoutName: string;
  value: unknown;
  note?: string;
  reviewedIn?: "scouting-ui" | "api";
}): DisagreementResolution {
  const note = input.note?.trim();
  return {
    outcome: "chose_scout",
    winningEntryId: input.entryId,
    winningScoutUserId: input.scoutUserId,
    winningScoutName: input.scoutName.trim() || "Scout",
    chosenValue: input.value,
    ...(note ? { note: note.slice(0, 500) } : {}),
    reviewedIn: input.reviewedIn ?? "scouting-ui",
  };
}

export function buildDismissResolution(input?: {
  note?: string;
  reviewedIn?: "scouting-ui" | "api";
}): DisagreementResolution {
  const note = input?.note?.trim();
  return {
    outcome: "dismissed",
    ...(note ? { note: note.slice(0, 500) } : {}),
    reviewedIn: input?.reviewedIn ?? "scouting-ui",
  };
}

export function validateResolution(
  resolution: DisagreementResolution,
  entryIds: string[],
): string | null {
  if (resolution.outcome === "dismissed") return null;
  if (resolution.outcome !== "chose_scout") return "Unknown resolution outcome";
  if (!resolution.winningEntryId) return "Pick which scout was right";
  if (!entryIds.includes(resolution.winningEntryId)) {
    return "Winning entry is not part of this disagreement";
  }
  if (!resolution.winningScoutUserId) return "Winning scout is required";
  return null;
}

export function resolutionSummary(resolution: DisagreementResolution | null | undefined): string {
  if (!resolution) return "No resolution recorded";
  if (resolution.outcome === "dismissed") {
    return resolution.note
      ? `Dismissed — ${resolution.note}`
      : "Dismissed without picking a winner";
  }
  const name = resolution.winningScoutName?.trim() || "Scout";
  const value = formatConflictValue(resolution.chosenValue);
  return resolution.note
    ? `${name} was right (${value}) — ${resolution.note}`
    : `${name} was right (${value})`;
}

/** Pair entry_ids[] with values[] from detectDisagreements storage. */
export function zipCandidates(
  entryIds: string[],
  values: unknown[],
  scouts: Array<{ entryId: string; scoutUserId: string; scoutName: string }>,
): DisagreementCandidate[] {
  const byId = new Map(scouts.map((scout) => [scout.entryId, scout]));
  return entryIds.map((entryId, index) => {
    const scout = byId.get(entryId);
    return {
      entryId,
      scoutUserId: scout?.scoutUserId ?? "",
      scoutName: scout?.scoutName?.trim() || "Unknown scout",
      value: values[index],
    };
  });
}
