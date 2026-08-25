/**
 * Presence spine types — RSVP, roll call, and clocked hours as ONE record.
 *
 * Honesty invariants that every type in here encodes:
 *   - `rsvp: null` means "never responded". It does NOT mean "no".
 *   - `attended: null` means "no roll call covers this person". It does NOT mean absent.
 *   - `minutes: null` means "no clocked time linked". It does NOT mean zero hours.
 * A member with none of the three signals produces NO row at all (see reconcile.ts).
 */

export const PRESENCE_RSVPS = ["going", "maybe", "no"] as const;
export type PresenceRsvp = (typeof PRESENCE_RSVPS)[number];

export const PRESENCE_SOURCES = ["rsvp", "roll_call", "kiosk", "manual"] as const;
export type PresenceSource = (typeof PRESENCE_SOURCES)[number];

export const PRESENCE_DISCREPANCIES = [
  "said_going_absent",
  "came_without_rsvp",
  "clocked_no_roll_call",
] as const;
export type PresenceDiscrepancyKind = (typeof PRESENCE_DISCREPANCIES)[number];
export type PresenceDiscrepancy = PresenceDiscrepancyKind | null;

export const PRESENCE_DISCREPANCY_LABELS: Record<PresenceDiscrepancyKind, string> = {
  said_going_absent: "Said going, not on the roll call",
  came_without_rsvp: "Came without an RSVP",
  clocked_no_roll_call: "Clocked hours, not on the roll call",
};

export const PRESENCE_DISCREPANCY_DETAILS: Record<PresenceDiscrepancyKind, string> = {
  said_going_absent:
    "A roll call was taken and they are not on it. They may have been missed rather than absent — confirm before recording.",
  came_without_rsvp: "They are on the roll call but never answered the invite.",
  clocked_no_roll_call:
    "Their shop session is linked to this meeting but the roll call does not list them.",
};

export const PRESENCE_RSVP_LABELS: Record<PresenceRsvp, string> = {
  going: "Going",
  maybe: "Maybe",
  no: "Not coming",
};

/** One RSVP signal for the occurrence being reconciled. */
export type PresenceRsvpSignal = {
  userId: string;
  name: string | null;
  response: PresenceRsvp;
  /**
   * `occurrence` = the RSVP is on a concrete row for this date.
   * `series` = the RSVP sits on the recurring master, so it is a standing answer
   * for the whole series rather than a promise about this specific night.
   */
  scope?: "occurrence" | "series";
};

/** One roll-call signal. Absence is only ever an explicit `present: false`. */
export type PresenceRollCallSignal = {
  userId: string;
  name: string | null;
  present: boolean;
  /** Credited hours typed on the attendance entry, when the team uses them. */
  hours?: number | null;
};

/** One clocked shop session already linked to this occurrence. */
export type PresenceHourSignal = {
  userId: string;
  name: string | null;
  hourLogId: string;
  minutes: number;
  /** Still clocked in — the minutes figure is "so far", not a final total. */
  open?: boolean;
};

export type PresenceMemberRow = {
  userId: string;
  name: string | null;
  occurrenceDate: string;
  rsvp: PresenceRsvp | null;
  rsvpScope: "occurrence" | "series" | null;
  attended: boolean | null;
  minutes: number | null;
  hourLogIds: string[];
  hasOpenSession: boolean;
  discrepancy: PresenceDiscrepancy;
};

/** A figure that may honestly be unavailable, with the reason spelled out. */
export type PresenceFigure = {
  value: number | null;
  reason: string | null;
  label: string;
};
