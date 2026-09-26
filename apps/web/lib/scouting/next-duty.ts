import { isBackupRole } from "./assignment-accountability";
import { matchOrderKey } from "./next-assignment";
import { labelForMatchKey, matchOpenForScouting, type ScheduleMatch } from "./next-match";

/**
 * "Which robot do I watch next?" — the first thing a scout opening Scouting needs.
 *
 * From the person's own assignments (the scouting bootstrap already returns only
 * theirs): the earliest primary duty that has not happened yet and that nobody has
 * already filed an entry for. Backups are skipped (a backup scouts only when the
 * primary does not). "Has not happened" is the shared still-to-come rule when the schedule
 * has the match (matchOpenForScouting: a late event keeps its unplayed match), else the
 * assignment's planned start with a grace window; without either, the entries alone decide.
 * The time shown is the match's own (actual, else predicted, else scheduled), not the time
 * written on the assignment when shifts were planned: schedules slip.
 */
export type DutyAssignment = {
  matchKey: string;
  teamKey: string;
  role?: string | null;
  startsAt?: string | null;
};

/** matches_ref stores an alliance as jsonb `{ teamKeys: [...] }`; plain arrays are accepted too. */
type Alliance = readonly string[] | { teamKeys?: readonly string[] | null } | null | undefined;
export type DutyMatch = {
  matchKey: string;
  redAlliance?: Alliance;
  blueAlliance?: Alliance;
  /** COALESCE(actual, predicted, scheduled): when the match ran or is expected to. */
  matchTime?: string | null;
  compLevel?: string | null;
  matchNumber?: number | null;
  actualTime?: string | null;
  predictedTime?: string | null;
  plannedTime?: string | null;
  postResultTime?: string | null;
  winningAlliance?: string | null;
};

function asScheduleMatch(match: DutyMatch): ScheduleMatch {
  const parsed = /_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(match.matchKey);
  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel ?? parsed?.[1]?.toLowerCase() ?? null,
    matchNumber: match.matchNumber ?? Number(parsed?.[3] ?? parsed?.[2] ?? 0),
    matchTime: match.matchTime,
    actualTime: match.actualTime,
    predictedTime: match.predictedTime,
    plannedTime: match.plannedTime,
    postResultTime: match.postResultTime,
    winningAlliance: match.winningAlliance,
  };
}

function teamKeysOf(alliance: Alliance): readonly string[] {
  if (!alliance) return [];
  if (Array.isArray(alliance)) return alliance;
  return (alliance as { teamKeys?: readonly string[] | null }).teamKeys ?? [];
}
export type DutyEntry = { type?: string; matchKey: string | null; teamKey: string };

export type NextDuty = {
  matchKey: string;
  teamKey: string;
  teamNumber: string;
  matchLabel: string;
  /** "Red 2" / "Blue 3" when the schedule says where the robot stands. */
  station: string | null;
  startsAt: string | null;
};

const GRACE_MS = 15 * 60_000;

export function nextScoutingDuty(input: {
  assignments: readonly DutyAssignment[];
  matches?: readonly DutyMatch[];
  entries?: readonly DutyEntry[];
  now?: Date;
}): NextDuty | null {
  const now = (input.now ?? new Date()).getTime();
  const filed = new Set(
    (input.entries ?? [])
      .filter((entry) => entry.matchKey && (entry.type ?? "match") === "match")
      .map((entry) => `${entry.matchKey}|${entry.teamKey}`),
  );
  const schedule = (input.matches ?? []).map(asScheduleMatch);
  const candidates = input.assignments
    .filter((assignment) => assignment.matchKey && assignment.teamKey && !isBackupRole(assignment.role))
    .filter((assignment) => !filed.has(`${assignment.matchKey}|${assignment.teamKey}`))
    .filter((assignment) => {
      // The match's own state wins over the assignment's: a match that already ran is not
      // "next", however the shift was planned, and one running late still is.
      const scheduled = schedule.find((row) => row.matchKey === assignment.matchKey);
      if (scheduled) return matchOpenForScouting(scheduled, schedule, now);
      const when = assignment.startsAt;
      if (!when) return true;
      const at = Date.parse(when);
      return Number.isNaN(at) || at >= now - GRACE_MS;
    })
    .map((assignment) => ({ assignment, order: matchOrderKey(assignment.matchKey) }))
    .filter((row): row is { assignment: DutyAssignment; order: [number, number, number] } => row.order !== null)
    .sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || a.order[2] - b.order[2]);

  const first = candidates[0]?.assignment;
  if (!first) return null;
  const match = input.matches?.find((row) => row.matchKey === first.matchKey);
  const redAt = teamKeysOf(match?.redAlliance).indexOf(first.teamKey);
  const blueAt = teamKeysOf(match?.blueAlliance).indexOf(first.teamKey);
  return {
    matchKey: first.matchKey,
    teamKey: first.teamKey,
    teamNumber: first.teamKey.replace(/^frc/i, ""),
    matchLabel: labelForMatchKey(first.matchKey) ?? first.matchKey,
    station: redAt >= 0 ? `Red ${redAt + 1}` : blueAt >= 0 ? `Blue ${blueAt + 1}` : null,
    startsAt: match?.matchTime ?? first.startsAt ?? null,
  };
}
