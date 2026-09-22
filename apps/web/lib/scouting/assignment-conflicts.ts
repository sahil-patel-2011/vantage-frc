// Who cannot be handed a robot in a given match.
//
// Two rules, both things a scouting lead checks by eye and gets wrong at 7am:
//
//   1. Same match, second robot. One person watches one robot. Assigning a
//      scout to 254 and 1678 in the same match guarantees one of them is empty.
//   2. Drive team. When our robot is on the field, the drive team is behind the
//      glass, not in the stands. Drive team membership comes from two real
//      sources, both keyed to a member account:
//        - team_roles with subteam 'drive_team' and a holder_user_id, for the
//          event's season — the standing drive team;
//        - duty_assignments of kind 'drive_team' with an assigned_user_id, whose
//          time window covers the match — a rotation (a human player who swaps
//          in for Saturday).
//      Either one, in a match our team plays, is a conflict. A match we are not
//      in is not a drive-team conflict: a driver scouting between our matches
//      is a normal thing to do.
//
// Pure. The loader in assignment-conflicts-load.ts builds the context from the
// database in one query per source.

export type ConflictMatch = {
  matchKey: string;
  teamKeys: readonly string[];
  /** Best known start (predicted → scheduled → actual). Null when TBA has none. */
  time: string | null;
};

export type DriveTeamDuty = {
  userId: string;
  startsAt: string;
  endsAt: string | null;
};

export type ConflictAssignment = {
  userId: string;
  matchKey: string;
  teamKey: string;
  role?: string | null;
};

export type AssignmentConflictContext = {
  /** "frc6925", or null when the team has no number set (then no drive-team rule applies). */
  ourTeamKey: string | null;
  /** Member ids holding a drive_team role this season. */
  standingDriveTeam: ReadonlySet<string>;
  driveDuties: readonly DriveTeamDuty[];
  matches: ReadonlyMap<string, ConflictMatch>;
  /** Existing assignments at this event, including ones made earlier in this request. */
  assignments: readonly ConflictAssignment[];
};

export type AssignmentConflict =
  | { kind: "drive_team"; userId: string; matchKey: string }
  | { kind: "same_match"; userId: string; matchKey: string; otherTeamKey: string };

/**
 * A duty with no end is read as running to the end of its day — twelve hours
 * from the start. Stretching it further would make one Friday duty block
 * Saturday too.
 */
export const OPEN_DUTY_SPAN_MS = 12 * 60 * 60 * 1000;

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isOnDriveTeamForMatch(
  ctx: Pick<AssignmentConflictContext, "ourTeamKey" | "standingDriveTeam" | "driveDuties" | "matches">,
  userId: string,
  matchKey: string,
): boolean {
  if (!ctx.ourTeamKey) return false;
  const match = ctx.matches.get(matchKey);
  if (!match || !match.teamKeys.includes(ctx.ourTeamKey)) return false;
  if (ctx.standingDriveTeam.has(userId)) return true;
  const at = parse(match.time);
  if (at == null) return false;
  return ctx.driveDuties.some((duty) => {
    if (duty.userId !== userId) return false;
    const start = parse(duty.startsAt);
    if (start == null) return false;
    const end = parse(duty.endsAt) ?? start + OPEN_DUTY_SPAN_MS;
    return at >= start && at <= end;
  });
}

/**
 * The reason this person cannot take this robot, or null when they can.
 *
 * Re-assigning someone to the robot they already hold is not a conflict — that
 * is an idempotent retry. Backups count too: a backup on 254 in Q12 is still
 * in the stands watching 254, and cannot also be primary on 1678.
 */
export function assignmentConflict(
  ctx: AssignmentConflictContext,
  candidate: { userId: string; matchKey: string; teamKey: string },
): AssignmentConflict | null {
  if (isOnDriveTeamForMatch(ctx, candidate.userId, candidate.matchKey)) {
    return { kind: "drive_team", userId: candidate.userId, matchKey: candidate.matchKey };
  }
  const other = ctx.assignments.find(
    (row) =>
      row.userId === candidate.userId &&
      row.matchKey === candidate.matchKey &&
      row.teamKey !== candidate.teamKey,
  );
  if (other) {
    return {
      kind: "same_match",
      userId: candidate.userId,
      matchKey: candidate.matchKey,
      otherTeamKey: other.teamKey,
    };
  }
  return null;
}

/** "Q12" from "2026gacmp_qm12", "SF2-1" from "…_sf2m1"; the raw key otherwise. */
export function labelFromMatchKey(matchKey: string): string {
  const match = /_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(matchKey);
  if (!match) return matchKey;
  const [, level = "", first = "", second] = match;
  const prefix = level.toLowerCase() === "qm" ? "Q" : level.toUpperCase();
  if (!second) return `${prefix}${first}`;
  if (level.toLowerCase() === "f" && first === "1") return `F${second}`;
  return `${prefix}${first}-${second}`;
}

/** One sentence a coordinator can act on. */
export function describeAssignmentConflict(conflict: AssignmentConflict, name?: string | null): string {
  const who = name?.trim() || "That scout";
  const label = labelFromMatchKey(conflict.matchKey);
  if (conflict.kind === "drive_team") {
    return `${who} is on drive team for ${label} — our robot is on the field, so they cannot scout it.`;
  }
  return `${who} is already scouting ${conflict.otherTeamKey.replace(/^frc/i, "")} in ${label} — one scout, one robot.`;
}

/** Adds a just-made assignment so the next check in the same request sees it. */
export function withAssignment(
  ctx: AssignmentConflictContext,
  row: ConflictAssignment,
): AssignmentConflictContext {
  return { ...ctx, assignments: [...ctx.assignments, row] };
}

