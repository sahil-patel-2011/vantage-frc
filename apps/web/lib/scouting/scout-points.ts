/**
 * The scouting points game: a little reward for the work that makes the data good. Every point
 * comes from something a scout actually filed, so it can't be gamed by tapping around.
 *
 * - 10 for each match report, 15 for each pit visit (they take longer)
 * - +5 for each robot they were assigned and did scout (showing up for your shift)
 * - their best streak: the most matches in a row (by match number) they filed a report for
 *
 * Missed assignments cost nothing here; the lead sees them separately.
 */

export const POINTS = { match: 10, pit: 15, assignedCovered: 5 } as const;

export type PointsEntry = { type: "match" | "pit"; matchKey: string | null; teamKey: string; scoutUserId: string };
export type PointsAssignment = { userId: string; matchKey: string; teamKey: string; role?: string | null };

export type ScoutPoints = { points: number; bestStreak: number; assignedCovered: number };

/** "2026casj_qm12" → 12 for qualification matches; null otherwise (streaks count quals only). */
function qualNumber(matchKey: string | null): number | null {
  const match = matchKey?.match(/_qm(\d+)$/);
  return match ? Number(match[1]) : null;
}

export function scoutPoints(input: {
  entries: readonly PointsEntry[];
  assignments: readonly PointsAssignment[];
  isBackupRole?: (role: string | null | undefined) => boolean;
}): Map<string, ScoutPoints> {
  const result = new Map<string, ScoutPoints>();
  const row = (userId: string) => {
    let value = result.get(userId);
    if (!value) {
      value = { points: 0, bestStreak: 0, assignedCovered: 0 };
      result.set(userId, value);
    }
    return value;
  };
  const filed = new Set<string>();
  const qualsByScout = new Map<string, Set<number>>();
  for (const entry of input.entries) {
    const value = row(entry.scoutUserId);
    value.points += entry.type === "pit" ? POINTS.pit : POINTS.match;
    if (entry.type === "match" && entry.matchKey) {
      filed.add(`${entry.scoutUserId}|${entry.matchKey}|${entry.teamKey}`);
      const number = qualNumber(entry.matchKey);
      if (number != null) {
        const set = qualsByScout.get(entry.scoutUserId) ?? new Set<number>();
        set.add(number);
        qualsByScout.set(entry.scoutUserId, set);
      }
    }
  }
  for (const assignment of input.assignments) {
    if (input.isBackupRole?.(assignment.role)) continue;
    if (!filed.has(`${assignment.userId}|${assignment.matchKey}|${assignment.teamKey}`)) continue;
    const value = row(assignment.userId);
    value.assignedCovered += 1;
    value.points += POINTS.assignedCovered;
  }
  for (const [userId, numbers] of qualsByScout) {
    const sorted = [...numbers].sort((a, b) => a - b);
    let best = 0;
    let run = 0;
    let previous: number | null = null;
    for (const number of sorted) {
      run = previous != null && number === previous + 1 ? run + 1 : 1;
      best = Math.max(best, run);
      previous = number;
    }
    row(userId).bestStreak = best;
  }
  return result;
}
