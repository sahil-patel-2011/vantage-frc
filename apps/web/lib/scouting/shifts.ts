// Scout shift planning — pure functions, no I/O.
//
// A shift is a contiguous block of qualification matches during which one scout watches
// ONE robot slot (alliance + driver station). Planning rotates the roster so nobody sits
// through the whole day, inserts breaks when a spare scout exists, and never assigns two
// scouts to the same robot slot in the same match. Everything here is deterministic so the
// server route, the lineup UI and the unit tests agree on the plan.

export type ShiftAlliance = "red" | "blue";
export type ShiftStation = 1 | 2 | 3;

export type ShiftMatch = {
  matchKey: string;
  matchNumber: number;
  red: string[];
  blue: string[];
  /** ISO time of the match (predicted > scheduled) — used for notification timing only. */
  scheduledTime?: string | null;
};

export type ShiftSlot = { alliance: ShiftAlliance; station: ShiftStation };

export type ShiftAssignment = {
  userId: string;
  matchKey: string;
  matchNumber: number;
  teamKey: string;
  alliance: ShiftAlliance;
  station: ShiftStation;
  /** True when this match pushed the scout past the soft break threshold. */
  fatigueWarning: boolean;
};

export type PlannedShift = {
  userId: string;
  matchStart: number;
  matchEnd: number;
  alliance: ShiftAlliance;
  station: ShiftStation;
  matchKeys: string[];
  fatigueWarning: boolean;
};

export type UnscoutedSlot = {
  matchKey: string;
  matchNumber: number;
  alliance: ShiftAlliance;
  station: ShiftStation;
  teamKey: string;
};

export type AssignShiftsOptions = {
  /** Hard cap: a scout can never work more than this many matches in a row. */
  maxConsecutive?: number;
  /** Soft rotation: after this many matches in a row, a fresh scout takes the slot when one exists. */
  breakEvery?: number;
  /** How many matches a scout rests once rotated out (default 1). */
  breakLength?: number;
};

export type AssignShiftsResult = {
  shifts: PlannedShift[];
  assignments: ShiftAssignment[];
  unscouted: UnscoutedSlot[];
  /** Scouts who were never assigned a single match (roster larger than the schedule). */
  idleScouts: string[];
};

export const SHIFT_SLOTS: readonly ShiftSlot[] = [
  { alliance: "red", station: 1 },
  { alliance: "red", station: 2 },
  { alliance: "red", station: 3 },
  { alliance: "blue", station: 1 },
  { alliance: "blue", station: 2 },
  { alliance: "blue", station: 3 },
];

export const DEFAULT_MAX_CONSECUTIVE = 10;
export const DEFAULT_BREAK_EVERY = 6;

export function slotKey(slot: ShiftSlot): string {
  return `${slot.alliance}${slot.station}`;
}

export function slotLabel(slot: ShiftSlot): string {
  return `${slot.alliance === "red" ? "R" : "B"}${slot.station}`;
}

/** The robot in a slot, or null when the alliance has fewer stations filled. */
export function teamInSlot(match: ShiftMatch, slot: ShiftSlot): string | null {
  const keys = slot.alliance === "red" ? match.red : match.blue;
  const key = keys[slot.station - 1];
  return typeof key === "string" && key ? key : null;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function sortShiftMatches(matches: readonly ShiftMatch[]): ShiftMatch[] {
  return [...matches].sort((a, b) => a.matchNumber - b.matchNumber || a.matchKey.localeCompare(b.matchKey));
}

type ScoutState = {
  consecutive: number;
  resting: number;
  total: number;
  lastSlot: string | null;
};

/**
 * Rotate `scouts` across every robot slot of `matches`.
 *
 * Per match, per slot, the scout is chosen by (1) continuity — whoever held the slot last
 * match keeps it while under the soft threshold, (2) a fresh scout when the holder is due
 * a break, (3) fewest matches worked so far, (4) roster order. A scout at the hard cap is
 * rested even if that leaves the slot unscouted — the gap is reported, never hidden.
 */
export function assignShifts(
  matchesInput: readonly ShiftMatch[],
  scoutsInput: readonly string[],
  options: AssignShiftsOptions = {},
): AssignShiftsResult {
  const scouts = [...new Set(scoutsInput.map((id) => id.trim()).filter(Boolean))];
  const matches = sortShiftMatches(matchesInput);
  const maxConsecutive = clampInt(options.maxConsecutive, DEFAULT_MAX_CONSECUTIVE, 1, 200);
  const breakEvery = Math.min(maxConsecutive, clampInt(options.breakEvery, DEFAULT_BREAK_EVERY, 1, 200));
  const breakLength = clampInt(options.breakLength, 1, 1, 50);

  const state = new Map<string, ScoutState>(
    scouts.map((id) => [id, { consecutive: 0, resting: 0, total: 0, lastSlot: null }]),
  );
  const assignments: ShiftAssignment[] = [];
  const unscouted: UnscoutedSlot[] = [];

  for (const match of matches) {
    const used = new Set<string>();
    for (const slot of SHIFT_SLOTS) {
      const teamKey = teamInSlot(match, slot);
      if (!teamKey) continue;
      const key = slotKey(slot);
      let best: string | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const scout of scouts) {
        if (used.has(scout)) continue;
        const s = state.get(scout)!;
        if (s.resting > 0 || s.consecutive >= maxConsecutive) continue;
        let score = 0;
        const dueBreak = s.consecutive >= breakEvery;
        if (s.lastSlot === key && !dueBreak) score -= 1000;
        else if (s.consecutive === 0) score -= 500;
        else if (s.lastSlot === key) score -= 100;
        score += s.total; // spread the day evenly
        if (score < bestScore) {
          bestScore = score;
          best = scout;
        }
      }
      if (!best) {
        unscouted.push({
          matchKey: match.matchKey,
          matchNumber: match.matchNumber,
          alliance: slot.alliance,
          station: slot.station,
          teamKey,
        });
        continue;
      }
      const s = state.get(best)!;
      s.consecutive += 1;
      s.total += 1;
      s.lastSlot = key;
      used.add(best);
      assignments.push({
        userId: best,
        matchKey: match.matchKey,
        matchNumber: match.matchNumber,
        teamKey,
        alliance: slot.alliance,
        station: slot.station,
        fatigueWarning: s.consecutive > breakEvery,
      });
    }
    for (const scout of scouts) {
      if (used.has(scout)) continue;
      const s = state.get(scout)!;
      if (s.consecutive > 0) {
        // Just rotated out: this match counts as the first rest match.
        s.resting = Math.max(0, breakLength - 1);
        s.consecutive = 0;
        s.lastSlot = null;
      } else if (s.resting > 0) {
        s.resting -= 1;
      }
    }
  }

  const idleScouts = scouts.filter((scout) => (state.get(scout)?.total ?? 0) === 0);
  return { shifts: shiftsFromAssignments(assignments, matches), assignments, unscouted, idleScouts };
}

/**
 * Collapse per-match assignments into contiguous (scout, slot) blocks. Contiguity follows
 * schedule order, so a skipped match number in the TBA schedule does not split a shift.
 */
export function shiftsFromAssignments(
  assignments: readonly ShiftAssignment[],
  matches: readonly ShiftMatch[],
): PlannedShift[] {
  const order = new Map(sortShiftMatches(matches).map((match, index) => [match.matchKey, index]));
  const sorted = [...assignments].sort(
    (a, b) => (order.get(a.matchKey) ?? a.matchNumber) - (order.get(b.matchKey) ?? b.matchNumber),
  );
  const open = new Map<string, PlannedShift & { lastIndex: number }>();
  const shifts: PlannedShift[] = [];
  const finish = (current: PlannedShift & { lastIndex: number }): PlannedShift => ({
    userId: current.userId,
    matchStart: current.matchStart,
    matchEnd: current.matchEnd,
    alliance: current.alliance,
    station: current.station,
    matchKeys: current.matchKeys,
    fatigueWarning: current.fatigueWarning,
  });
  for (const row of sorted) {
    const key = `${row.userId}|${row.alliance}${row.station}`;
    const index = order.get(row.matchKey) ?? row.matchNumber;
    const current = open.get(key);
    if (current && current.lastIndex === index - 1) {
      current.matchEnd = row.matchNumber;
      current.matchKeys.push(row.matchKey);
      current.lastIndex = index;
      current.fatigueWarning = current.fatigueWarning || row.fatigueWarning;
      continue;
    }
    if (current) shifts.push(finish(current));
    open.set(key, {
      userId: row.userId,
      matchStart: row.matchNumber,
      matchEnd: row.matchNumber,
      alliance: row.alliance,
      station: row.station,
      matchKeys: [row.matchKey],
      fatigueWarning: row.fatigueWarning,
      lastIndex: index,
    });
  }
  for (const current of open.values()) shifts.push(finish(current));
  return shifts.sort(
    (a, b) => a.matchStart - b.matchStart || a.userId.localeCompare(b.userId) || slotKey(a).localeCompare(slotKey(b)),
  );
}

export type ShiftLike = {
  userId: string;
  matchStart: number;
  matchEnd: number;
  alliance: ShiftAlliance | null;
  station: ShiftStation | null;
};

/** Expand a shift into the per-match robot assignments it covers (slot-less shifts cover nothing). */
export function expandShift(shift: ShiftLike, matches: readonly ShiftMatch[]): ShiftAssignment[] {
  if (!shift.alliance || !shift.station) return [];
  const slot: ShiftSlot = { alliance: shift.alliance, station: shift.station };
  const rows: ShiftAssignment[] = [];
  for (const match of sortShiftMatches(matches)) {
    if (match.matchNumber < shift.matchStart || match.matchNumber > shift.matchEnd) continue;
    const teamKey = teamInSlot(match, slot);
    if (!teamKey) continue;
    rows.push({
      userId: shift.userId,
      matchKey: match.matchKey,
      matchNumber: match.matchNumber,
      teamKey,
      alliance: slot.alliance,
      station: slot.station,
      fatigueWarning: false,
    });
  }
  return rows;
}

export type UnscoutedMatch = {
  matchKey: string;
  matchNumber: number;
  gaps: UnscoutedSlot[];
};

/** Matches with at least one robot slot no shift covers. Empty when the roster covers everything. */
export function unscoutedMatches(
  matches: readonly ShiftMatch[],
  shifts: readonly ShiftLike[],
): UnscoutedMatch[] {
  const covered = new Set<string>();
  for (const shift of shifts) {
    if (!shift.alliance || !shift.station) continue;
    for (let n = shift.matchStart; n <= shift.matchEnd; n++) {
      covered.add(`${n}|${shift.alliance}${shift.station}`);
    }
  }
  const result: UnscoutedMatch[] = [];
  for (const match of sortShiftMatches(matches)) {
    const gaps: UnscoutedSlot[] = [];
    for (const slot of SHIFT_SLOTS) {
      const teamKey = teamInSlot(match, slot);
      if (!teamKey) continue;
      if (covered.has(`${match.matchNumber}|${slotKey(slot)}`)) continue;
      gaps.push({
        matchKey: match.matchKey,
        matchNumber: match.matchNumber,
        alliance: slot.alliance,
        station: slot.station,
        teamKey,
      });
    }
    if (gaps.length) result.push({ matchKey: match.matchKey, matchNumber: match.matchNumber, gaps });
  }
  return result;
}

export type NotifiableShift = ShiftLike & { id: string; notifyMinutesBefore: number };

export type ShiftStartingSoon<T extends NotifiableShift> = {
  shift: T;
  startsAt: string;
  minutesUntil: number;
};

/**
 * Shifts whose first match is due within each shift's own `notifyMinutesBefore` window
 * (inclusive), measured against `now`. Matches without a time are skipped rather than
 * guessed; a match that already started (up to `graceMinutes` ago) still counts so a late
 * poll does not lose the reminder.
 */
export function shiftsStartingWithin<T extends NotifiableShift>(
  shifts: readonly T[],
  matches: readonly ShiftMatch[],
  now: Date | number = Date.now(),
  graceMinutes = 2,
): Array<ShiftStartingSoon<T>> {
  const nowMs = typeof now === "number" ? now : now.getTime();
  const timeByNumber = new Map<number, string>();
  for (const match of matches) {
    if (match.scheduledTime) timeByNumber.set(match.matchNumber, match.scheduledTime);
  }
  const due: Array<ShiftStartingSoon<T>> = [];
  for (const shift of shifts) {
    const startsAt = timeByNumber.get(shift.matchStart);
    if (!startsAt) continue;
    const startMs = Date.parse(startsAt);
    if (!Number.isFinite(startMs)) continue;
    const minutesUntil = (startMs - nowMs) / 60_000;
    if (minutesUntil > shift.notifyMinutesBefore || minutesUntil < -graceMinutes) continue;
    due.push({ shift, startsAt, minutesUntil: Math.round(minutesUntil * 10) / 10 });
  }
  return due.sort((a, b) => a.minutesUntil - b.minutesUntil);
}

/** "QM 4–9 · R2" — the label the roster, the inbox and the timeline all share. */
export function shiftLabel(shift: ShiftLike): string {
  const range = shift.matchStart === shift.matchEnd ? `QM ${shift.matchStart}` : `QM ${shift.matchStart}–${shift.matchEnd}`;
  const slot =
    shift.alliance && shift.station ? ` · ${slotLabel({ alliance: shift.alliance, station: shift.station })}` : "";
  return `${range}${slot}`;
}
