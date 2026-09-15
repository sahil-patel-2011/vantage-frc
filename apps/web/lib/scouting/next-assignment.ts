/**
 * Collection-class assignment queue: the next unscouted robot this member owns.
 * Never invents a match. Empty when there are no assignments.
 */

export type AssignmentRobot = {
  matchKey: string;
  teamKey: string;
  compLevel?: string;
  matchNumber?: number;
  label?: string;
};

export type ScoutedEntryRef = {
  type?: string;
  matchKey?: string | null;
  teamKey?: string;
  scoutUserId?: string;
};

export function scoutTeamLabel(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

export function assignmentPairKey(matchKey: string, teamKey: string): string {
  return `${matchKey.trim().toLowerCase()}|${teamKey.trim().toLowerCase()}`;
}

export function formatAssignmentLabel(assignment: AssignmentRobot): string {
  if (assignment.label?.trim()) return assignment.label.trim();
  const team = scoutTeamLabel(assignment.teamKey);
  const level = (assignment.compLevel ?? "qm").toUpperCase();
  if (assignment.matchNumber != null && Number.isFinite(assignment.matchNumber)) {
    return `${level} ${assignment.matchNumber} · ${team}`;
  }
  return `${assignment.matchKey} · ${team}`;
}

export function sameAssignmentRobot(
  left: Pick<AssignmentRobot, "matchKey" | "teamKey">,
  right: Pick<AssignmentRobot, "matchKey" | "teamKey">,
): boolean {
  return assignmentPairKey(left.matchKey, left.teamKey) === assignmentPairKey(right.matchKey, right.teamKey);
}

export function scoutedAssignmentKeys(
  entries: readonly ScoutedEntryRef[],
  scoutUserId?: string | null,
  extra: readonly Pick<AssignmentRobot, "matchKey" | "teamKey">[] = [],
): Set<string> {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (entry.type && entry.type !== "match") continue;
    if (!entry.matchKey || !entry.teamKey) continue;
    if (scoutUserId && entry.scoutUserId && entry.scoutUserId !== scoutUserId) continue;
    keys.add(assignmentPairKey(entry.matchKey, entry.teamKey));
  }
  for (const row of extra) {
    keys.add(assignmentPairKey(row.matchKey, row.teamKey));
  }
  return keys;
}

export function isAssignmentScouted(
  assignment: Pick<AssignmentRobot, "matchKey" | "teamKey">,
  scouted: ReadonlySet<string>,
): boolean {
  return scouted.has(assignmentPairKey(assignment.matchKey, assignment.teamKey));
}

export function nextUnscoutedAssignment<T extends AssignmentRobot>(
  assignments: readonly T[],
  scouted: ReadonlySet<string>,
): T | null {
  for (const assignment of assignments) {
    if (!isAssignmentScouted(assignment, scouted)) return assignment;
  }
  return null;
}

export function remainingUnscoutedCount(
  assignments: readonly AssignmentRobot[],
  current: Pick<AssignmentRobot, "matchKey" | "teamKey"> | null,
  scouted: ReadonlySet<string>,
): number {
  return assignments.filter((assignment) => {
    if (isAssignmentScouted(assignment, scouted)) return false;
    if (current && sameAssignmentRobot(assignment, current)) return false;
    return true;
  }).length;
}

/**
 * After a successful save, move to this scout's next assigned robot.
 * Schedule-only scouting (no lineup rows) steps the match number and keeps the team.
 */
export function advanceAfterMatchSave<T extends AssignmentRobot>(input: {
  assignments: readonly T[];
  saved: Pick<AssignmentRobot, "matchKey" | "teamKey">;
  scouted: ReadonlySet<string>;
  stepMatchKey: (matchKey: string) => string | null;
}): { matchKey: string; teamKey: string } | null {
  if (input.assignments.length) {
    const next = nextUnscoutedAssignment(input.assignments, input.scouted);
    if (!next) return null;
    if (sameAssignmentRobot(next, input.saved)) return null;
    return { matchKey: next.matchKey, teamKey: next.teamKey };
  }
  const stepped = input.stepMatchKey(input.saved.matchKey);
  if (!stepped) return null;
  return { matchKey: stepped, teamKey: input.saved.teamKey };
}
