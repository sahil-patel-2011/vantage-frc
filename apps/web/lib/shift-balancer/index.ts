export * from "./types";

import type { ShiftBalancerAssignment, ShiftBalancerScout, ShiftBalancerSummary } from "./types";

export const DEFAULT_STATIONS = ["Red 1", "Red 2", "Red 3", "Blue 1", "Blue 2", "Blue 3"];

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
