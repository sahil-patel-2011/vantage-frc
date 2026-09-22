// Assigned but not submitted.
//
// Coverage boards count entries per robot, which answers "do we have data on
// 1678 in Q14" — not "did the person we put on 1678 in Q14 actually scout it".
// A coordinator needs the second question answered while the match is still
// fresh enough to ask the scout, or to pull the video.
//
// Pure: rows in, list out. The schedule route and /scout-coverage-live feed it
// the rows they already load.

/**
 * `scout_assignments.role` is free text. Publishing a shift plan writes the
 * station ("Red 2"), the lineup writes "primary", the trust auto-assigner
 * writes "primary-fatigue-cap". Only the exact word "backup" means backup;
 * everything else is a primary duty.
 */
export const BACKUP_ROLE = "backup";

export function isBackupRole(role: string | null | undefined): boolean {
  return (role ?? "").trim().toLowerCase() === BACKUP_ROLE;
}

export type AccountabilityAssignment = {
  matchKey: string;
  teamKey: string;
  userId: string;
  name?: string | null;
  role?: string | null;
};

export type AccountabilityEntry = {
  matchKey: string;
  teamKey: string;
  scoutUserId: string;
};

export type MissedAssignment = {
  matchKey: string;
  teamKey: string;
  userId: string;
  name: string;
  role: "primary" | "backup";
  /** Someone else's entry exists for this robot — the data is there, the duty was not done. */
  robotScouted: boolean;
};

/**
 * Every assignment in a played match with no entry from that scout for that
 * match + robot.
 *
 * "Played" is the caller's call — pass the matches whose results are posted,
 * in schedule order; the output keeps that order. Waiting for posted results
 * gives a scout the minutes it takes to hit save before they are listed.
 *
 * A backup is only listed when every primary on that robot also missed (or
 * there was no primary): the backup is expected to scout only if the primary
 * does not.
 */
export function detectMissedAssignments(input: {
  assignments: readonly AccountabilityAssignment[];
  entries: readonly AccountabilityEntry[];
  playedMatchKeys: readonly string[];
}): MissedAssignment[] {
  const order = new Map<string, number>();
  input.playedMatchKeys.forEach((matchKey, index) => {
    if (!order.has(matchKey)) order.set(matchKey, index);
  });
  if (order.size === 0) return [];

  const byScout = new Set<string>();
  const byRobot = new Set<string>();
  for (const entry of input.entries) {
    byScout.add(`${entry.matchKey}|${entry.teamKey}|${entry.scoutUserId}`);
    byRobot.add(`${entry.matchKey}|${entry.teamKey}`);
  }

  const primarySubmitted = new Set<string>();
  for (const row of input.assignments) {
    if (isBackupRole(row.role)) continue;
    if (byScout.has(`${row.matchKey}|${row.teamKey}|${row.userId}`)) primarySubmitted.add(`${row.matchKey}|${row.teamKey}`);
  }

  const missed: MissedAssignment[] = [];
  const seen = new Set<string>();
  for (const row of input.assignments) {
    if (!order.has(row.matchKey)) continue;
    const robot = `${row.matchKey}|${row.teamKey}`;
    const id = `${robot}|${row.userId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (byScout.has(id)) continue;
    const backup = isBackupRole(row.role);
    if (backup && primarySubmitted.has(robot)) continue;
    missed.push({
      matchKey: row.matchKey,
      teamKey: row.teamKey,
      userId: row.userId,
      name: row.name?.trim() || "Team member",
      role: backup ? "backup" : "primary",
      robotScouted: byRobot.has(robot),
    });
  }

  return missed.sort(
    (a, b) =>
      (order.get(a.matchKey) ?? 0) - (order.get(b.matchKey) ?? 0) ||
      a.teamKey.localeCompare(b.teamKey, undefined, { numeric: true }) ||
      (a.role === b.role ? 0 : a.role === "primary" ? -1 : 1) ||
      a.name.localeCompare(b.name),
  );
}

/** Who to chase first: missed robots nobody else covered, then the rest. */
export function summarizeMissed(missed: readonly MissedAssignment[]): {
  total: number;
  uncovered: number;
  byScout: Array<{ userId: string; name: string; count: number }>;
} {
  const byScout = new Map<string, { userId: string; name: string; count: number }>();
  let uncovered = 0;
  for (const row of missed) {
    if (!row.robotScouted) uncovered += 1;
    const existing = byScout.get(row.userId);
    if (existing) existing.count += 1;
    else byScout.set(row.userId, { userId: row.userId, name: row.name, count: 1 });
  }
  return {
    total: missed.length,
    uncovered,
    byScout: [...byScout.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}
