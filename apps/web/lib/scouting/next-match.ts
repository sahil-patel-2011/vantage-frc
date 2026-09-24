/**
 * Which match a scout should be looking at right now, and the six robots in it.
 *
 * Replaces a 200-row "Select match and team" dropdown that always started at Qual 1. The
 * card shows one match at a time with its six robots as big red and blue buttons, starting
 * at the scout's next assignment or, without one, the first match after the last one the
 * team has scouting for. Arrows step through the schedule. Pure, so it is tested.
 */

export type ScheduleMatch = {
  matchKey: string;
  matchNumber: number;
  compLevel?: string | null;
  redAlliance?: { teamKeys?: string[] | null } | null;
  blueAlliance?: { teamKeys?: string[] | null } | null;
  /** When it ran or will run (actual, else predicted, else scheduled). */
  matchTime?: string | null;
};

/**
 * True when every match on the schedule is over (more than three hours past its time, the same
 * rule Home and Event day use), so the card should not call anything "next".
 */
export function scheduleIsOver(schedule: ScheduleMatch[], now = Date.now()): boolean {
  if (!schedule.length) return false;
  return schedule.every((match) => {
    const time = match.matchTime ? Date.parse(match.matchTime) : NaN;
    return Number.isFinite(time) && time < now - 3 * 60 * 60 * 1000;
  });
}

export type ScoutedEntry = { matchKey: string | null; teamKey: string };
export type Assignment = { matchKey: string; teamKey: string };

export type RobotSlot = {
  teamKey: string;
  teamNumber: string;
  alliance: "red" | "blue";
  station: 1 | 2 | 3;
  assignedToYou: boolean;
  scouted: boolean;
};

export type MatchCard = {
  index: number;
  total: number;
  match: ScheduleMatch;
  label: string;
  robots: RobotSlot[];
};

const LEVEL_ORDER: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
const LEVEL_LABEL: Record<string, string> = { qm: "Qual", ef: "Eighth", qf: "Quarter", sf: "Semi", f: "Final" };

export function orderedSchedule(matches: ScheduleMatch[]): ScheduleMatch[] {
  return [...matches].sort((a, b) => {
    const level = (LEVEL_ORDER[a.compLevel ?? "qm"] ?? 9) - (LEVEL_ORDER[b.compLevel ?? "qm"] ?? 9);
    return level || a.matchNumber - b.matchNumber || a.matchKey.localeCompare(b.matchKey);
  });
}

export function matchLabel(match: ScheduleMatch): string {
  const level = match.compLevel ?? "qm";
  const set = /_(?:ef|qf|sf)(\d+)m\d+$/.exec(match.matchKey)?.[1];
  const base = LEVEL_LABEL[level] ?? level.toUpperCase();
  return set ? `${base} ${set}-${match.matchNumber}` : `${base} ${match.matchNumber}`;
}

/**
 * Where the card opens: the first of your assignments from the next unscouted match on,
 * else that next match. "Next" is the match after the latest one the team has any
 * scouting for, so a scout arriving mid-event is not sent back to Qual 1.
 */
export function nextMatchIndex(
  schedule: ScheduleMatch[],
  scouted: ScoutedEntry[],
  assignments: Assignment[],
): number {
  if (!schedule.length) return -1;
  const scoutedMatches = new Set(scouted.map((entry) => entry.matchKey).filter(Boolean));
  let latest = -1;
  schedule.forEach((match, index) => {
    if (scoutedMatches.has(match.matchKey)) latest = index;
  });
  const from = Math.min(latest + 1, schedule.length - 1);
  const mine = new Set(assignments.map((assignment) => assignment.matchKey));
  if (mine.size) {
    for (let index = from; index < schedule.length; index++) {
      if (mine.has(schedule[index]!.matchKey)) return index;
    }
  }
  return from;
}

export function matchCard(
  schedule: ScheduleMatch[],
  index: number,
  scouted: ScoutedEntry[],
  assignments: Assignment[],
): MatchCard | null {
  const match = schedule[index];
  if (!match) return null;
  const done = new Set(scouted.map((entry) => `${entry.matchKey}|${entry.teamKey}`));
  const mine = new Set(assignments.map((assignment) => `${assignment.matchKey}|${assignment.teamKey}`));
  const slots = (alliance: "red" | "blue", keys: string[] | null | undefined): RobotSlot[] =>
    (keys ?? []).slice(0, 3).map((teamKey, position) => ({
      teamKey,
      teamNumber: teamKey.replace(/^frc/, ""),
      alliance,
      station: (position + 1) as 1 | 2 | 3,
      assignedToYou: mine.has(`${match.matchKey}|${teamKey}`),
      scouted: done.has(`${match.matchKey}|${teamKey}`),
    }));
  return {
    index,
    total: schedule.length,
    match,
    label: matchLabel(match),
    robots: [...slots("red", match.redAlliance?.teamKeys), ...slots("blue", match.blueAlliance?.teamKeys)],
  };
}
