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
        row.station,
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
}): ShiftBalancerAssignment[] {
  const roster = input.scouts.filter((scout) => scout.active);
  const matchCount = Math.max(0, Math.round(input.matchCount));
  const stations = input.stations.length > 0 ? input.stations : DEFAULT_STATIONS;
  const cap = Math.max(1, Math.round(input.maxConsecutiveMatches));

  if (roster.length === 0 || matchCount === 0) return [];

  const streak = new Map<string, number>(roster.map((s) => [s.id, 0]));
  const totalShifts = new Map<string, number>(roster.map((s) => [s.id, 0]));
  const assignments: ShiftBalancerAssignment[] = [];

  for (let match = 1; match <= matchCount; match += 1) {
    const eligible = roster.filter((s) => (streak.get(s.id) ?? 0) < cap);
    // Fair-share order: fewest total shifts first, then lowest current streak, then roster order.
    const pool = (eligible.length > 0 ? eligible : roster).slice().sort((a, b) => {
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

export function summarizePlan(input: {
  scouts: ShiftBalancerScout[];
  matchCount: number;
  stations: string[];
  assignments: ShiftBalancerAssignment[];
}): ShiftBalancerSummary {
  const scoutById = new Map(input.scouts.map((s) => [s.id, s]));
  const shiftsByScout = new Map<string, number>();
  const streakByScout = new Map<string, { current: number; longest: number }>();

  const byMatch = new Map<number, Set<string>>();
  for (const assignment of input.assignments) {
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

  return {
    totalMatches: Math.max(0, Math.round(input.matchCount)),
    totalShifts: input.assignments.length,
    scoutsUsed: loadByScout.filter((l) => l.shifts > 0).length,
    maxLoad: shiftCounts.length > 0 ? Math.max(...shiftCounts) : 0,
    minLoad: shiftCounts.length > 0 ? Math.min(...shiftCounts) : 0,
    rosterShortfall: activeIds.length < stationsPerMatch,
    loadByScout,
  };
}
