export * from "./types";

import type { ShiftBalancerAssignment, ShiftBalancerScout, ShiftBalancerSummary } from "./types";

export const DEFAULT_STATIONS = ["Red 1", "Red 2", "Red 3", "Blue 1", "Blue 2", "Blue 3"];

export type ScheduleSlot = {
  matchKey: string;
  matchNumber: number;
  station: string;
  teamKey: string;
  teamNumber: number;
  scheduledAt?: string | null;
};

/** Skyehawk / CD schedulers try to end shifts on lunch and other field gaps. */
export const NATURAL_BREAK_MINUTES = 25;

function allianceTeamKeys(alliance: unknown): string[] {
  if (!alliance || typeof alliance !== "object") return [];
  const keys = (alliance as { teamKeys?: unknown }).teamKeys;
  return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === "string") : [];
}

function teamNumberFromKey(teamKey: string): number | null {
  const match = /^frc(\d{1,5})$/i.exec(teamKey.trim());
  return match ? Number(match[1]) : null;
}

/** Flatten TBA qualification alliances into Red 1–3 / Blue 1–3 slots. Empty cache stays empty. */
export function scheduleSlotsFromQuals(
  rows: Array<{
    matchKey: string;
    matchNumber: number;
    redAlliance: unknown;
    blueAlliance: unknown;
    scheduledAt?: string | null;
  }>,
): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];
  const ordered = [...rows].sort((a, b) => a.matchNumber - b.matchNumber);
  for (const row of ordered) {
    const red = allianceTeamKeys(row.redAlliance);
    const blue = allianceTeamKeys(row.blueAlliance);
    const paired: Array<{ station: string; teamKey: string }> = [
      { station: "Red 1", teamKey: red[0] ?? "" },
      { station: "Red 2", teamKey: red[1] ?? "" },
      { station: "Red 3", teamKey: red[2] ?? "" },
      { station: "Blue 1", teamKey: blue[0] ?? "" },
      { station: "Blue 2", teamKey: blue[1] ?? "" },
      { station: "Blue 3", teamKey: blue[2] ?? "" },
    ];
    for (const pair of paired) {
      const teamNumber = teamNumberFromKey(pair.teamKey);
      if (!teamNumber) continue;
      slots.push({
        matchKey: row.matchKey,
        matchNumber: row.matchNumber,
        station: pair.station,
        teamKey: pair.teamKey,
        teamNumber,
        scheduledAt: row.scheduledAt ?? null,
      });
    }
  }
  return slots;
}

/** Attach TBA match/team identity onto a fatigue-capped rotation. */
export function overlayScheduleOnRotation(
  assignments: ShiftBalancerAssignment[],
  slots: ScheduleSlot[],
): ShiftBalancerAssignment[] {
  if (!slots.length) return assignments;
  const matchNumbers = [...new Set(slots.map((slot) => slot.matchNumber))].sort((a, b) => a - b);
  const byKey = new Map(slots.map((slot) => [`${slot.matchNumber}|${slot.station}`, slot]));
  const timeByMatch = new Map<number, string>();
  for (const slot of slots) {
    if (slot.scheduledAt && !timeByMatch.has(slot.matchNumber)) {
      timeByMatch.set(slot.matchNumber, slot.scheduledAt);
    }
  }
  return assignments.map((assignment) => {
    const matchNumber = matchNumbers[assignment.match - 1];
    if (matchNumber == null) return assignment;
    const slot = byKey.get(`${matchNumber}|${assignment.station}`);
    if (!slot) return assignment;
    const nextMatch = matchNumbers[assignment.match];
    const gap = gapMinutes(timeByMatch.get(matchNumber) ?? slot.scheduledAt, nextMatch != null ? timeByMatch.get(nextMatch) : undefined);
    return {
      ...assignment,
      matchKey: slot.matchKey,
      teamKey: slot.teamKey,
      teamNumber: slot.teamNumber,
      matchLabel: `QM ${slot.matchNumber}`,
      scheduledAt: slot.scheduledAt ?? undefined,
      breakAfterMinutes: gap != null && gap >= NATURAL_BREAK_MINUTES ? Math.round(gap) : undefined,
    };
  });
}

/**
 * Per-match constraints for generateRotation, from the real qualification schedule.
 *
 * Match indexes are 1-based positions in the sorted list of qual numbers — the
 * same mapping overlayScheduleOnRotation uses — so a constraint lands on the
 * match it was computed for.
 *
 *   - unavailable: scout ids `blockedScouts(matchKey)` names for that match
 *     (drive team while our robot plays).
 *   - backupStations: with `backups` on, in every match our team plays, the
 *     plan stations holding a partner or an opponent. Our own robot gets no
 *     backup — it is scouted by the drive team, and pit crew have the data.
 */
export function rotationConstraintsFromSlots(input: {
  slots: ScheduleSlot[];
  stations: readonly string[];
  ourTeamKey: string | null;
  backups: boolean;
  blockedScouts?: (matchKey: string) => Iterable<string>;
}): { unavailable: Map<number, Set<string>>; backupStations: Map<number, string[]> } {
  const unavailable = new Map<number, Set<string>>();
  const backupStations = new Map<number, string[]>();
  const matchNumbers = [...new Set(input.slots.map((slot) => slot.matchNumber))].sort((a, b) => a - b);
  const planStations = new Set(input.stations);
  matchNumbers.forEach((matchNumber, position) => {
    const index = position + 1;
    const slots = input.slots.filter((slot) => slot.matchNumber === matchNumber);
    const matchKey = slots[0]?.matchKey;
    if (!matchKey) return;
    if (input.blockedScouts) {
      const blocked = new Set(input.blockedScouts(matchKey));
      if (blocked.size) unavailable.set(index, blocked);
    }
    if (input.backups && input.ourTeamKey && slots.some((slot) => slot.teamKey === input.ourTeamKey)) {
      const stations = slots
        .filter((slot) => slot.teamKey !== input.ourTeamKey && planStations.has(slot.station))
        .map((slot) => slot.station);
      if (stations.length) backupStations.set(index, stations);
    }
  });
  return { unavailable, backupStations };
}

export function gapMinutes(fromIso: string | null | undefined, toIso: string | null | undefined): number | null {
  if (!fromIso || !toIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return (to - from) / 60_000;
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Print/CSV sheet CD teams tape to each scouting tablet. */
export type TabletSheet = {
  scoutId: string;
  scoutName: string;
  rows: ShiftBalancerAssignment[];
};

export function tabletSheetsByScout(assignments: ShiftBalancerAssignment[]): TabletSheet[] {
  const byScout = new Map<string, TabletSheet>();
  for (const assignment of assignments) {
    const existing = byScout.get(assignment.scoutId);
    if (existing) {
      existing.rows.push(assignment);
      continue;
    }
    byScout.set(assignment.scoutId, {
      scoutId: assignment.scoutId,
      scoutName: assignment.scoutName,
      rows: [assignment],
    });
  }
  return [...byScout.values()].sort((a, b) => a.scoutName.localeCompare(b.scoutName));
}

export function planToCsv(input: { label: string; assignments: ShiftBalancerAssignment[] }): string {
  const header = ["Plan", "Match", "Match key", "Station", "Team", "Scout", "Scheduled", "Break after (min)"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of input.assignments) {
    lines.push(
      [
        input.label,
        row.matchLabel ?? row.match,
        row.matchKey ?? "",
        row.role === "backup" ? `${row.station} (backup)` : row.station,
        row.teamNumber ?? "",
        row.scoutName,
        row.scheduledAt ?? "",
        row.breakAfterMinutes ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Deterministically rotates the active roster across matches/stations, giving priority to
 * scouts with the fewest shifts so far, while never letting a scout work more than
 * `maxConsecutiveMatches` matches in a row without a bye (a match sat out resets their streak).
 */
export function generateRotation(input: {
  scouts: ShiftBalancerScout[];
  matchCount: number;
  stations: string[];
  maxConsecutiveMatches: number;
  /**
   * Scout ids that cannot work a given match (1-based plan match index) —
   * drive team when our robot is on the field. They are never picked for it,
   * as primary or backup.
   */
  unavailable?: ReadonlyMap<number, ReadonlySet<string>>;
  /**
   * Stations that also get a backup scout, per plan match index. A backup is
   * someone not already working that match; they watch in case the primary
   * misses. Backups do not count toward shifts or the consecutive-match cap —
   * they are sitting in the stands either way.
   */
  backupStations?: ReadonlyMap<number, readonly string[]>;
}): ShiftBalancerAssignment[] {
  const roster = input.scouts.filter((scout) => scout.active);
  const matchCount = Math.max(0, Math.round(input.matchCount));
  const stations = input.stations.length > 0 ? input.stations : DEFAULT_STATIONS;
  const cap = Math.max(1, Math.round(input.maxConsecutiveMatches));

  if (roster.length === 0 || matchCount === 0) return [];

  const streak = new Map<string, number>(roster.map((s) => [s.id, 0]));
  const totalShifts = new Map<string, number>(roster.map((s) => [s.id, 0]));
  const backupShifts = new Map<string, number>(roster.map((s) => [s.id, 0]));
  const assignments: ShiftBalancerAssignment[] = [];

  for (let match = 1; match <= matchCount; match += 1) {
    const blocked = input.unavailable?.get(match);
    const available = blocked?.size ? roster.filter((s) => !blocked.has(s.id)) : roster;
    const eligible = available.filter((s) => (streak.get(s.id) ?? 0) < cap);
    // Fair-share order: fewest total shifts first, then lowest current streak, then roster order.
    const pool = (eligible.length > 0 ? eligible : available).slice().sort((a, b) => {
      const shiftDiff = (totalShifts.get(a.id) ?? 0) - (totalShifts.get(b.id) ?? 0);
      if (shiftDiff !== 0) return shiftDiff;
      const streakDiff = (streak.get(a.id) ?? 0) - (streak.get(b.id) ?? 0);
      if (streakDiff !== 0) return streakDiff;
      return roster.indexOf(a) - roster.indexOf(b);
    });

    const picked = new Set<string>();
    for (const station of stations) {
      const candidate = pool.find((s) => !picked.has(s.id));
      if (!candidate) break;
      picked.add(candidate.id);
      assignments.push({ match, station, scoutId: candidate.id, scoutName: candidate.name });
      totalShifts.set(candidate.id, (totalShifts.get(candidate.id) ?? 0) + 1);
    }

    // Backups come from whoever is not already working this match, fewest
    // backup duties first, so one person is not the permanent understudy.
    const needBackup = input.backupStations?.get(match) ?? [];
    if (needBackup.length > 0) {
      const benched = available
        .filter((s) => !picked.has(s.id))
        .sort(
          (a, b) =>
            (backupShifts.get(a.id) ?? 0) - (backupShifts.get(b.id) ?? 0) ||
            (totalShifts.get(a.id) ?? 0) - (totalShifts.get(b.id) ?? 0) ||
            roster.indexOf(a) - roster.indexOf(b),
        );
      const backedUp = new Set<string>();
      for (const station of needBackup) {
        const candidate = benched.find((s) => !backedUp.has(s.id));
        if (!candidate) break;
        backedUp.add(candidate.id);
        assignments.push({ match, station, scoutId: candidate.id, scoutName: candidate.name, role: "backup" });
        backupShifts.set(candidate.id, (backupShifts.get(candidate.id) ?? 0) + 1);
      }
    }

    for (const scout of roster) {
      if (picked.has(scout.id)) {
        streak.set(scout.id, (streak.get(scout.id) ?? 0) + 1);
      } else {
        streak.set(scout.id, 0);
      }
    }
  }

  return assignments;
}

/**
 * What it would take to cover every robot in every match without breaking the
 * "max in a row" rule. Each match leaves (scouts − stations) people sitting
 * out, and every scout has to sit at least once in any (cap + 1) matches, so
 * full coverage needs (scouts − stations) × (cap + 1) ≥ scouts.
 *
 * Returns the smallest roster that works with this cap, and the smallest cap
 * that works with this roster (null when no cap can: fewer scouts than robots).
 */
export function rotationCoverageFix(input: {
  activeScouts: number;
  stationsPerMatch: number;
  maxConsecutiveMatches: number;
}): { minScouts: number; minCap: number | null } {
  const stations = Math.max(1, Math.round(input.stationsPerMatch));
  const cap = Math.max(1, Math.round(input.maxConsecutiveMatches));
  const scouts = Math.max(0, Math.round(input.activeScouts));
  const minScouts = Math.max(stations, Math.ceil((stations * (cap + 1)) / cap));
  const spare = scouts - stations;
  const minCap = spare > 0 ? Math.max(1, Math.ceil(scouts / spare) - 1) : null;
  return { minScouts, minCap };
}

export function summarizePlan(input: {
  scouts: ShiftBalancerScout[];
  matchCount: number;
  stations: string[];
  assignments: ShiftBalancerAssignment[];
  /** The plan's cap, so the summary can say what would fill the gaps. */
  maxConsecutiveMatches?: number;
}): ShiftBalancerSummary {
  const backupShifts = input.assignments.filter((assignment) => assignment.role === "backup").length;
  const primaries = backupShifts ? input.assignments.filter((assignment) => assignment.role !== "backup") : input.assignments;
  const scoutById = new Map(input.scouts.map((s) => [s.id, s]));
  const shiftsByScout = new Map<string, number>();
  const streakByScout = new Map<string, { current: number; longest: number }>();

  const byMatch = new Map<number, Set<string>>();
  for (const assignment of primaries) {
    shiftsByScout.set(assignment.scoutId, (shiftsByScout.get(assignment.scoutId) ?? 0) + 1);
    if (!byMatch.has(assignment.match)) byMatch.set(assignment.match, new Set());
    byMatch.get(assignment.match)!.add(assignment.scoutId);
  }

  const activeIds = input.scouts.filter((s) => s.active).map((s) => s.id);
  for (const scoutId of activeIds) streakByScout.set(scoutId, { current: 0, longest: 0 });

  const matches = Array.from(byMatch.keys()).sort((a, b) => a - b);
  for (const match of matches) {
    const worked = byMatch.get(match) ?? new Set();
    for (const scoutId of activeIds) {
      const state = streakByScout.get(scoutId) ?? { current: 0, longest: 0 };
      if (worked.has(scoutId)) {
        state.current += 1;
        state.longest = Math.max(state.longest, state.current);
      } else {
        state.current = 0;
      }
      streakByScout.set(scoutId, state);
    }
  }

  const loadByScout = activeIds
    .map((scoutId) => ({
      scoutId,
      scoutName: scoutById.get(scoutId)?.name ?? "Unknown scout",
      shifts: shiftsByScout.get(scoutId) ?? 0,
      longestStreak: streakByScout.get(scoutId)?.longest ?? 0,
    }))
    .sort((a, b) => b.shifts - a.shifts);

  const shiftCounts = loadByScout.map((l) => l.shifts);
  const stationsPerMatch = input.stations.length > 0 ? input.stations.length : DEFAULT_STATIONS.length;

  // Robots nobody is scouting. A rotation that hits the "max in a row" rule for
  // several scouts at once leaves stations empty; the lead has to see that.
  const labelByMatch = new Map<number, string>();
  const filledByMatch = new Map<number, number>();
  for (const assignment of primaries) {
    filledByMatch.set(assignment.match, (filledByMatch.get(assignment.match) ?? 0) + 1);
    if (assignment.matchLabel && !labelByMatch.has(assignment.match)) {
      labelByMatch.set(assignment.match, assignment.matchLabel);
    }
  }
  const totalMatches = Math.max(0, Math.round(input.matchCount));
  const unfilledMatches: ShiftBalancerSummary["unfilledMatches"] = [];
  let unfilledSlots = 0;
  for (let match = 1; match <= totalMatches; match += 1) {
    const missing = Math.max(0, stationsPerMatch - (filledByMatch.get(match) ?? 0));
    if (missing === 0) continue;
    unfilledSlots += missing;
    unfilledMatches.push({ match, label: labelByMatch.get(match) ?? `Match ${match}`, missing });
  }
  const fix =
    unfilledSlots > 0 && input.maxConsecutiveMatches != null
      ? rotationCoverageFix({
          activeScouts: activeIds.length,
          stationsPerMatch,
          maxConsecutiveMatches: input.maxConsecutiveMatches,
        })
      : null;

  return {
    totalMatches,
    totalShifts: primaries.length,
    unfilledSlots,
    unfilledMatches,
    ...(fix ? { coverageFix: fix } : {}),
    scoutsUsed: loadByScout.filter((l) => l.shifts > 0).length,
    maxLoad: shiftCounts.length > 0 ? Math.max(...shiftCounts) : 0,
    minLoad: shiftCounts.length > 0 ? Math.min(...shiftCounts) : 0,
    rosterShortfall: activeIds.length < stationsPerMatch,
    loadByScout,
    ...(backupShifts ? { backupShifts } : {}),
  };
}

/**
 * The one sentence a lead reads when a plan leaves robots unscouted: which
 * matches, how many robots, and the two ways to close the gap.
 */
export function describeUnfilled(summary: Pick<ShiftBalancerSummary, "unfilledSlots" | "unfilledMatches" | "coverageFix" | "rosterShortfall">): string | null {
  if (summary.unfilledSlots <= 0 || summary.unfilledMatches.length === 0) return null;
  const shown = summary.unfilledMatches.slice(0, 4).map((row) => row.label);
  const more = summary.unfilledMatches.length - shown.length;
  const where = more > 0 ? `${shown.join(", ")} and ${more} more ${more === 1 ? "match" : "matches"}` : shown.join(", ");
  const robots = `${summary.unfilledSlots} ${summary.unfilledSlots === 1 ? "robot" : "robots"}`;
  const fix = summary.coverageFix;
  let how = "Add a scout or raise \"Max matches in a row\".";
  if (fix) {
    const options = [`have ${fix.minScouts} active scouts`];
    if (fix.minCap != null) options.push(`raise "Max matches in a row" to ${fix.minCap}`);
    how = `To cover every robot, ${options.join(" or ")}.`;
  }
  return `${robots} have no scout in ${where}. ${how}`;
}

/** A plan row ready to become a scout_assignments row for a real member. */
export type PublishableAssignment = {
  userId: string;
  matchKey: string;
  teamKey: string;
  station: string;
  startsAt: string | null;
  /** Present only for a backup; a primary row keeps its station as the role. */
  role?: "backup";
};

export type PublishPreview = {
  rows: PublishableAssignment[];
  /** Shifts belonging to scouts with no account — they keep their tablet sheet. */
  skippedNoMember: number;
  /** Shifts the schedule never filled in, so there is no match or team to point at. */
  skippedNoMatch: number;
  /**
   * Shifts refused at publish time: the member is on drive team for that match,
   * or already holds another robot in it (from the lineup, or an earlier publish).
   */
  skippedConflict?: number;
};

/**
 * Turn a generated plan into assignments for real people.
 *
 * The balancer's roster is free text, so a finished plan could only ever be a
 * CSV and a printed sheet — the student it was planned for never saw it.
 * Schedule, the pre-match briefing, Event Day command and the Home dashboard all
 * already read scout_assignments; this is the step that was missing between
 * them.
 *
 * Two kinds of row are dropped rather than guessed at:
 *   - a scout with no linked member has nobody to assign to (a parent volunteer
 *     still rotates in the plan and still gets a tablet sheet);
 *   - a shift with no matchKey/teamKey was never overlaid on a real schedule, so
 *     there is no match to point at. Inventing one would put a student in front
 *     of a robot that is not playing.
 *
 * Both are counted and reported, so publishing says what it did not do.
 */
export function publishableAssignments(
  assignments: ShiftBalancerAssignment[],
  scouts: Array<{ id: string; userId?: string | null }>,
): PublishPreview {
  const memberByScout = new Map(
    scouts.filter((scout) => scout.userId).map((scout) => [scout.id, scout.userId as string]),
  );
  const rows: PublishableAssignment[] = [];
  const seen = new Set<string>();
  let skippedNoMember = 0;
  let skippedNoMatch = 0;

  for (const assignment of assignments) {
    const userId = memberByScout.get(assignment.scoutId);
    if (!userId) {
      skippedNoMember += 1;
      continue;
    }
    if (!assignment.matchKey || !assignment.teamKey) {
      skippedNoMatch += 1;
      continue;
    }
    // scout_assignments is unique on (org, user, match, team); collapse repeats
    // here so a publish cannot fight its own conflict clause.
    const key = `${userId}|${assignment.matchKey}|${assignment.teamKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      userId,
      matchKey: assignment.matchKey,
      teamKey: assignment.teamKey,
      station: assignment.station,
      startsAt: assignment.scheduledAt ?? null,
      ...(assignment.role === "backup" ? { role: "backup" as const } : {}),
    });
  }

  return { rows, skippedNoMember, skippedNoMatch };
}

/** One line a student reads after publishing. Never claims rows it skipped. */
export function describePublish(preview: PublishPreview): string {
  if (preview.rows.length === 0) {
    if (preview.skippedNoMember > 0 && preview.skippedNoMatch === 0) {
      return "Nothing to publish — link scouts to team members first.";
    }
    if (preview.skippedNoMatch > 0) {
      return "Nothing to publish — build the plan from the event schedule first.";
    }
    if ((preview.skippedConflict ?? 0) > 0) {
      return "Nothing to publish — every shift clashed with drive team or another robot in the same match.";
    }
    return "Nothing to publish yet.";
  }
  const parts = [`${preview.rows.length} shift${preview.rows.length === 1 ? "" : "s"} published`];
  if (preview.skippedNoMember > 0) {
    parts.push(`${preview.skippedNoMember} for scouts without an account`);
  }
  if (preview.skippedNoMatch > 0) {
    parts.push(`${preview.skippedNoMatch} with no match yet`);
  }
  if ((preview.skippedConflict ?? 0) > 0) {
    parts.push(`${preview.skippedConflict} that clashed with drive team or another robot in the same match`);
  }
  return parts.length === 1 ? `${parts[0]}.` : `${parts[0]}; skipped ${parts.slice(1).join(" and ")}.`;
}
