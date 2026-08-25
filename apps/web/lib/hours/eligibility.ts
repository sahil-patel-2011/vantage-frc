// Per-member hours totals against the org's travel-eligibility threshold.
// Pure and unit-tested; the API route aggregates the raw totals in SQL and this
// module decides what the mentor is actually allowed to be told.
//
// Honesty rule from the evidence base: many teams gate travel or drive-team
// slots on logged build hours, but plenty do not. `thresholdHours: null` means
// this team has NOT configured one, and every label in here says exactly that
// instead of inventing a 60-hour requirement nobody set.

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Raw per-member totals as aggregated by the kiosk API. */
export type MemberHoursTotal = {
  userId: string;
  name: string | null;
  role: string;
  totalHours: number;
  sessions: number;
  /** Sessions the forgot-to-sign-out sweep closed and flagged. */
  autoClosedCount: number;
  /** Clock-in of the member's currently open session, when they are in the shop. */
  openSince: string | null;
};

export type EligibilityStatus = "not_configured" | "met" | "short";

export type MemberEligibilityRow = MemberHoursTotal & {
  thresholdHours: number | null;
  status: EligibilityStatus;
  /** Hours still needed; null when no threshold is configured. */
  remainingHours: number | null;
  /** 0-100 progress, capped; null when no threshold is configured. */
  percent: number | null;
  /** "42 of 60 hours" — or the honest no-threshold sentence. */
  label: string;
  /** Set when some of the total came from flagged auto-closed sessions. */
  reviewNote: string | null;
};

export const NO_THRESHOLD_LABEL = "No travel-hours threshold set for this team";

/** "42 of 60 hours" · "42 hours logged (no threshold set)". */
export function formatHoursAgainstThreshold(
  totalHours: number,
  thresholdHours: number | null,
): string {
  const total = round2(totalHours);
  if (thresholdHours == null) return `${total} hours logged · ${NO_THRESHOLD_LABEL.toLowerCase()}`;
  return `${total} of ${round2(thresholdHours)} hours`;
}

/** Normalize a submitted threshold: blank/0-or-less/garbage all mean "unset". */
export function normalizeThreshold(input: unknown): number | null {
  if (input == null || input === "") return null;
  const value = Number(input);
  if (!Number.isFinite(value) || value <= 0) return null;
  return round2(Math.min(value, 10_000));
}

function reviewNote(row: MemberHoursTotal): string | null {
  if (row.autoClosedCount <= 0) return null;
  const plural = row.autoClosedCount === 1 ? "session" : "sessions";
  return `${row.autoClosedCount} auto-closed ${plural} in this total — capped pending mentor review`;
}

export function memberEligibility(
  row: MemberHoursTotal,
  thresholdHours: number | null,
): MemberEligibilityRow {
  const totalHours = round2(Math.max(0, row.totalHours));
  if (thresholdHours == null) {
    return {
      ...row,
      totalHours,
      thresholdHours: null,
      status: "not_configured",
      remainingHours: null,
      percent: null,
      label: formatHoursAgainstThreshold(totalHours, null),
      reviewNote: reviewNote(row),
    };
  }
  const threshold = round2(thresholdHours);
  const met = totalHours >= threshold;
  return {
    ...row,
    totalHours,
    thresholdHours: threshold,
    status: met ? "met" : "short",
    remainingHours: met ? 0 : round2(threshold - totalHours),
    percent: threshold > 0 ? Math.min(100, Math.round((totalHours / threshold) * 100)) : null,
    label: formatHoursAgainstThreshold(totalHours, threshold),
    reviewNote: reviewNote(row),
  };
}

/**
 * Whole-roster view, shortest-remaining first when a threshold exists (the
 * mentor cares who is close to eligible), otherwise most-hours first.
 */
export function eligibilityBoard(
  totals: MemberHoursTotal[],
  thresholdHours: number | null,
): MemberEligibilityRow[] {
  const rows = totals.map((row) => memberEligibility(row, thresholdHours));
  return rows.sort((a, b) => {
    if (a.status !== b.status) {
      const rank: Record<EligibilityStatus, number> = { short: 0, met: 1, not_configured: 0 };
      const diff = rank[a.status] - rank[b.status];
      if (diff !== 0) return diff;
    }
    if (a.remainingHours != null && b.remainingHours != null && a.status === "short") {
      const diff = a.remainingHours - b.remainingHours;
      if (diff !== 0) return diff;
    }
    const byHours = b.totalHours - a.totalHours;
    if (byHours !== 0) return byHours;
    return (a.name ?? "").localeCompare(b.name ?? "");
  });
}

export type EligibilitySummary = {
  thresholdHours: number | null;
  membersCounted: number;
  eligible: number | null;
  short: number | null;
  flaggedSessions: number;
  headline: string;
};

/**
 * `thresholdHours` is passed explicitly rather than read off rows[0]: an org
 * with a configured threshold and an empty roster would otherwise be told "no
 * threshold set", which is the exact fabrication this module exists to avoid.
 */
export function summarizeEligibility(
  rows: MemberEligibilityRow[],
  thresholdHours: number | null = rows[0]?.thresholdHours ?? null,
): EligibilitySummary {
  const flaggedSessions = rows.reduce((sum, row) => sum + row.autoClosedCount, 0);
  if (thresholdHours == null) {
    return {
      thresholdHours: null,
      membersCounted: rows.length,
      eligible: null,
      short: null,
      flaggedSessions,
      headline: `${NO_THRESHOLD_LABEL}. Set one to turn these totals into a travel-eligibility check.`,
    };
  }
  const eligible = rows.filter((row) => row.status === "met").length;
  return {
    thresholdHours,
    membersCounted: rows.length,
    eligible,
    short: rows.length - eligible,
    flaggedSessions,
    headline: rows.length
      ? `${eligible} of ${rows.length} members are at or past ${thresholdHours} hours.`
      : `Travel threshold is ${thresholdHours} hours. No member hours logged yet.`,
  };
}
