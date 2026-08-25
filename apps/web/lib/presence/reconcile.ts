/**
 * reconcilePresence — fold the three presence stores into one row per member.
 *
 * The whole point of the presence spine is that "who is coming tonight"
 * (subteam_calendar_rsvps) and "who was here" (attendance_entries + hour_logs)
 * stop being two unrelated answers. This module is where they meet, and it is
 * deliberately paranoid about what it will and will not conclude:
 *
 *   1. An RSVP is never evidence of attendance. Saying "going" on Monday does
 *      not put you in the shop on Tuesday.
 *   2. Attendance is never evidence of an RSVP. Showing up does not retroactively
 *      create a response.
 *   3. A member with no RSVP, no roll-call entry and no linked hours produces NO
 *      ROW. Silence is not absence, and the roster view labels those people
 *      "no record" rather than counting them against anyone.
 *   4. `attended: false` is only ever set from an explicit roll-call mark. When a
 *      roll call exists and a "going" member is simply missing from it, we do not
 *      flip them to absent — we raise the `said_going_absent` DISCREPANCY, which
 *      is a question for a human, not a stored fact.
 *
 * Pure, dependency-free, deterministic. No clock reads.
 */

import type {
  PresenceDiscrepancy,
  PresenceHourSignal,
  PresenceMemberRow,
  PresenceRollCallSignal,
  PresenceRsvp,
  PresenceRsvpSignal,
} from "./types";

export type ReconcileInput = {
  rsvps: PresenceRsvpSignal[];
  rollCall: PresenceRollCallSignal[];
  hourLogs: PresenceHourSignal[];
  occurrenceDate: string;
  /**
   * True when a roll call actually exists for this occurrence. Without it we have
   * nothing to contradict, so no "not on the roll call" discrepancy can be raised
   * — a night nobody took roll is not a night everybody skipped.
   */
  rollCallTaken?: boolean;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

type Accumulator = {
  userId: string;
  name: string | null;
  rsvp: PresenceRsvp | null;
  rsvpScope: "occurrence" | "series" | null;
  attended: boolean | null;
  minutes: number | null;
  hourLogIds: string[];
  hasOpenSession: boolean;
};

function slot(map: Map<string, Accumulator>, userId: string, name: string | null): Accumulator {
  const existing = map.get(userId);
  if (existing) {
    if (!existing.name && name) existing.name = name;
    return existing;
  }
  const created: Accumulator = {
    userId,
    name: name ?? null,
    rsvp: null,
    rsvpScope: null,
    attended: null,
    minutes: null,
    hourLogIds: [],
    hasOpenSession: false,
  };
  map.set(userId, created);
  return created;
}

function classify(row: Accumulator, rollCallTaken: boolean): PresenceDiscrepancy {
  // These three are mutually exclusive by construction; the guards below make
  // that explicit rather than relying on evaluation order.
  if (row.attended === true && row.rsvp == null) return "came_without_rsvp";
  if (!rollCallTaken) return null;
  if (row.attended === true) return null;
  if (row.minutes != null && row.minutes > 0) return "clocked_no_roll_call";
  if (row.rsvp === "going") return "said_going_absent";
  return null;
}

/**
 * One row per member who left at least one signal for this occurrence.
 * Sorted discrepancies-first (that is the mentor's work queue), then by name.
 */
export function reconcilePresence(input: ReconcileInput): PresenceMemberRow[] {
  const rollCallTaken = input.rollCallTaken ?? input.rollCall.length > 0;
  const map = new Map<string, Accumulator>();

  for (const rsvp of input.rsvps) {
    if (!rsvp.userId) continue;
    const row = slot(map, rsvp.userId, rsvp.name);
    // A concrete-occurrence answer always beats a standing series answer.
    if (row.rsvp == null || (row.rsvpScope === "series" && rsvp.scope !== "series")) {
      row.rsvp = rsvp.response;
      row.rsvpScope = rsvp.scope ?? "occurrence";
    }
  }

  for (const mark of input.rollCall) {
    if (!mark.userId) continue;
    const row = slot(map, mark.userId, mark.name);
    // Any present mark wins over an absent mark: a duplicate paper entry should
    // never erase the fact that somebody was seen in the room.
    if (mark.present) row.attended = true;
    else if (row.attended !== true) row.attended = false;
  }

  for (const log of input.hourLogs) {
    if (!log.userId) continue;
    const row = slot(map, log.userId, log.name);
    const minutes = Number.isFinite(log.minutes) ? Math.max(0, log.minutes) : 0;
    row.minutes = round2((row.minutes ?? 0) + minutes);
    if (log.hourLogId) row.hourLogIds.push(log.hourLogId);
    if (log.open) row.hasOpenSession = true;
  }

  const rows: PresenceMemberRow[] = [];
  for (const row of map.values()) {
    // Defensive: a signal-free accumulator can only appear if a caller passed an
    // empty-shaped entry. Silence never becomes a row.
    const hasSignal = row.rsvp != null || row.attended != null || row.minutes != null;
    if (!hasSignal) continue;
    rows.push({
      userId: row.userId,
      name: row.name,
      occurrenceDate: input.occurrenceDate,
      rsvp: row.rsvp,
      rsvpScope: row.rsvpScope,
      attended: row.attended,
      minutes: row.minutes,
      hourLogIds: row.hourLogIds,
      hasOpenSession: row.hasOpenSession,
      discrepancy: classify(row, rollCallTaken),
    });
  }

  return rows.sort((a, b) => {
    const flagged = Number(b.discrepancy != null) - Number(a.discrepancy != null);
    if (flagged !== 0) return flagged;
    return (a.name ?? a.userId).localeCompare(b.name ?? b.userId);
  });
}

/** User ids on the roster who left no signal at all — "no record", never "absent". */
export function noRecordMembers(
  roster: { userId: string; name: string | null }[],
  rows: PresenceMemberRow[],
): { userId: string; name: string | null }[] {
  const seen = new Set(rows.map((row) => row.userId));
  return roster
    .filter((member) => !seen.has(member.userId))
    .sort((a, b) => (a.name ?? a.userId).localeCompare(b.name ?? b.userId));
}

/** Only the flagged rows, in the same discrepancy-first order. */
export function presenceDiscrepancies(rows: PresenceMemberRow[]): PresenceMemberRow[] {
  return rows.filter((row) => row.discrepancy != null);
}
