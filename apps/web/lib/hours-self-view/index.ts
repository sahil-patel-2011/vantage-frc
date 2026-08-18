// Pure aggregation + gate logic for hours self-view. Deterministic given its
// input — no I/O, no clock reads other than what callers pass in.

import type {
  BiometricConsentRecord,
  BiometricGate,
  HourLogKind,
  HoursSelfEntry,
  HoursSelfSummary,
  ShopPresence,
} from "./types";

export const HOUR_LOG_KINDS: HourLogKind[] = ["build", "meeting", "outreach", "competition", "other"];

const round1 = (value: number) => Math.round(value * 10) / 10;

export function hourLogKindLabel(kind: HourLogKind): string {
  const labels: Record<HourLogKind, string> = {
    build: "Build / shop time",
    meeting: "Meeting",
    outreach: "Outreach",
    competition: "Competition",
    other: "Other",
  };
  return labels[kind];
}

/**
 * Summarize a member's own hour_logs entries. Open sessions (no clock_out) count
 * zero minutes toward totals but surface as `openEntry` so the UI can show "in progress".
 */
export function summarizeHoursSelfEntries(entries: HoursSelfEntry[]): HoursSelfSummary {
  let totalMinutes = 0;
  let openEntry: HoursSelfEntry | null = null;
  const kindMap = new Map<HourLogKind, { entries: number; minutes: number }>();

  for (const entry of entries) {
    if (entry.clockOut == null && !openEntry) openEntry = entry;
    const minutes = Math.max(0, entry.minutes || 0);
    totalMinutes += minutes;

    const bucket = kindMap.get(entry.kind) ?? { entries: 0, minutes: 0 };
    bucket.entries += 1;
    bucket.minutes += minutes;
    kindMap.set(entry.kind, bucket);
  }

  const byKind = [...kindMap.entries()]
    .map(([kind, value]) => ({ kind, entries: value.entries, minutes: value.minutes, hours: round1(value.minutes / 60) }))
    .sort((a, b) => b.minutes - a.minutes);

  return {
    totalEntries: entries.length,
    totalMinutes,
    totalHours: round1(totalMinutes / 60),
    openEntry,
    byKind,
  };
}

/**
 * Compute minutes for a closed hour_logs interval. Returns 0 for still-open sessions.
 */
export function minutesBetween(clockIn: string, clockOut: string | null): number {
  if (!clockOut) return 0;
  const start = Date.parse(clockIn);
  const end = Date.parse(clockOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

/** Open clock-ins on the shop floor right now — never invents names or hours. */
export function summarizeWhoIsHere(
  rows: Array<{ userId: string; displayName: string; kind: HourLogKind; clockIn: string }>,
  nowIso: string,
): ShopPresence[] {
  return rows
    .map((row) => ({
      userId: row.userId,
      displayName: row.displayName.trim() || "Member",
      kind: row.kind,
      clockIn: row.clockIn,
      minutesOpen: minutesBetween(row.clockIn, nowIso),
    }))
    .sort((a, b) => a.clockIn.localeCompare(b.clockIn));
}

/**
 * Biometric legal guardrail: minors may never clock in with biometrics unless a
 * guardian/admin has recorded explicit consent. Adults (is_minor = false) are
 * unrestricted. No consent record on file for a minor defaults to blocked.
 */
export function evaluateBiometricGate(consent: BiometricConsentRecord | null): BiometricGate {
  if (!consent) {
    return { allowed: false, reason: "No consent record on file — biometric clock-in is blocked until reviewed." };
  }
  if (!consent.isMinor) {
    return { allowed: true, reason: "Adult member — biometric clock-in permitted." };
  }
  if (consent.status === "granted") {
    return { allowed: true, reason: "Guardian consent on file — biometric clock-in permitted." };
  }
  if (consent.status === "denied") {
    return { allowed: false, reason: "Guardian consent was denied — biometric clock-in is blocked." };
  }
  return { allowed: false, reason: "Minor member — guardian consent is pending. Biometric clock-in is blocked." };
}
