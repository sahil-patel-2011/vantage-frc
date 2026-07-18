// Pure, unit-testable helpers for Scout Disagreements. No I/O, no framework imports.

import type {
  ScoutDisagreement,
  ScoutDisagreementStatus,
  ScoutDisagreementSummary,
  ScoutDisagreementValue,
} from "./types";

export function scoutDisagreementStatusLabel(status: ScoutDisagreementStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "resolved":
      return "Resolved";
    case "dismissed":
      return "Dismissed";
    default:
      return status;
  }
}

/** Distinct reported values, in first-seen order — used to render the conflict quickly. */
export function distinctValues(values: ScoutDisagreementValue[]): string[] {
  const seen: string[] = [];
  for (const entry of values) {
    if (!seen.includes(entry.value)) seen.push(entry.value);
  }
  return seen;
}

/** A disagreement only meaningfully conflicts when scouts reported 2+ distinct values. */
export function isGenuineConflict(values: ScoutDisagreementValue[]): boolean {
  return distinctValues(values).length >= 2;
}

export function summarizeDisagreements(items: ScoutDisagreement[]): ScoutDisagreementSummary {
  const matches = new Set<string>();
  const fields = new Set<string>();
  let totalOpen = 0;
  let totalResolved = 0;
  let totalDismissed = 0;

  for (const item of items) {
    matches.add(`${item.matchNumber}`);
    fields.add(item.fieldKey);
    if (item.status === "open") totalOpen += 1;
    else if (item.status === "resolved") totalResolved += 1;
    else if (item.status === "dismissed") totalDismissed += 1;
  }

  return {
    totalOpen,
    totalResolved,
    totalDismissed,
    distinctMatches: matches.size,
    distinctFields: fields.size,
  };
}

export function sortDisagreementsForQueue(items: ScoutDisagreement[]): ScoutDisagreement[] {
  const rank: Record<ScoutDisagreementStatus, number> = { open: 0, resolved: 1, dismissed: 2 };
  return [...items].sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    if (a.matchNumber !== b.matchNumber) return a.matchNumber - b.matchNumber;
    return a.fieldKey.localeCompare(b.fieldKey);
  });
}
