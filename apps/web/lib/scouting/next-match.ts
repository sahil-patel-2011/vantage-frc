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
  now: number = Date.now(),
): number {
  if (!schedule.length) return -1;
  const from = startIndex(schedule, scouted, now);
  const mine = new Set(assignments.map((assignment) => assignment.matchKey));
  if (mine.size) {
    for (let index = from; index < schedule.length; index++) {
      if (mine.has(schedule[index]!.matchKey)) return index;
    }
  }
  return from;
}

/**
 * Where a scout starts. With match times: the first match not yet over (its time at most five
 * minutes ago, or ahead) that still has a robot nobody scouted. Starting one past the latest match
 * with any entry sent every scout to Qual 34 because of one stray entry on Qual 33, while Qual 31
 * to 33 were still to play. Without times (an offseason event typed in by hand), the old rule:
 * one past the latest match with scouting.
 */
function startIndex(schedule: ScheduleMatch[], scouted: ScoutedEntry[], now: number): number {
  const timed = schedule.some((match) => match.matchTime && Number.isFinite(Date.parse(match.matchTime)));
  if (timed) {
    const done = new Set(scouted.map((entry) => `${entry.matchKey}|${entry.teamKey}`));
    for (let index = 0; index < schedule.length; index++) {
      const match = schedule[index]!;
      const time = match.matchTime ? Date.parse(match.matchTime) : NaN;
      if (Number.isFinite(time) && time < now - 5 * 60 * 1000) continue;
      const robots = [...(match.redAlliance?.teamKeys ?? []), ...(match.blueAlliance?.teamKeys ?? [])];
      if (robots.length === 0 || robots.some((team) => !done.has(`${match.matchKey}|${team}`))) return index;
    }
  }
  const scoutedMatches = new Set(scouted.map((entry) => entry.matchKey).filter(Boolean));
  let latest = -1;
  schedule.forEach((match, index) => {
    if (scoutedMatches.has(match.matchKey)) latest = index;
  });
  return Math.min(latest + 1, schedule.length - 1);
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
