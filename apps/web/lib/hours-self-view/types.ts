// Hours self-view domain types. Pure data shapes — no I/O, no framework imports.
// Read-only own-hours view over existing hour_logs (build hours), plus locked
// kiosk-mode device state and the biometric consent gate for minors.

export type HourLogKind = "build" | "meeting" | "outreach" | "competition" | "other";

export type HoursSelfEntry = {
  id: string;
  kind: HourLogKind;
  /** ISO timestamp. */
  clockIn: string;
  /** ISO timestamp, null while the session is still open. */
  clockOut: string | null;
  minutes: number;
  note: string;
};

export type HoursSelfSummary = {
  totalEntries: number;
  totalMinutes: number;
  totalHours: number;
  openEntry: HoursSelfEntry | null;
  byKind: Array<{ kind: HourLogKind; entries: number; minutes: number; hours: number }>;
};

export type KioskSessionStatus = {
  id: string;
  deviceLabel: string;
  isLocked: boolean;
  lastActiveAt: string | null;
  createdAt: string;
};

export type BiometricConsentStatus = "not_required" | "pending" | "granted" | "denied";

export type BiometricConsentRecord = {
  isMinor: boolean;
  status: BiometricConsentStatus;
  guardianName: string | null;
  recordedAt: string | null;
};

/** Whether biometric clock-in is currently permitted for this member. */
export type BiometricGate = {
  allowed: boolean;
  reason: string;
};

/** TimeKeeper-style live shop floor: members with an open hour_logs session. */
export type ShopPresence = {
  userId: string;
  displayName: string;
  kind: HourLogKind;
  clockIn: string;
  minutesOpen: number;
};
