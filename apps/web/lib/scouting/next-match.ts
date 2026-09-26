/**
 * Which match a scout should be looking at right now, and the six robots in it.
 *
 * Replaces a 200-row "Select match and team" dropdown that always started at Qual 1. The
 * card shows one match at a time with its six robots as big red and blue buttons, starting
 * at the scout's next assignment or, without one, the first match after the last one the
 * team has scouting for. Arrows step through the schedule. Pure, so it is tested.
 */

import { isMatchStillAhead, type ScheduleMatch as BoardMatch } from "../schedule-board";

export type ScheduleMatch = {
  matchKey: string;
  matchNumber: number;
  compLevel?: string | null;
  redAlliance?: { teamKeys?: string[] | null } | null;
  blueAlliance?: { teamKeys?: string[] | null } | null;
  /** When it ran or will run (actual, else predicted, else scheduled). */
  matchTime?: string | null;
  /**
   * Match status, sent by the bootstrap since the scout screens moved to the shared "still to
   * come" rule. Undefined (not null) on a copy saved on the phone before then.
   */
  actualTime?: string | null;
  predictedTime?: string | null;
  plannedTime?: string | null;
  postResultTime?: string | null;
  winningAlliance?: string | null;
};

/** A scout still filling in the match that just started keeps it for this long. */
const JUST_PLAYED_MS = 10 * 60_000;
/** The old clock rule, for a copy of the schedule saved before match status was sent. */
const LEGACY_PLAYED_AFTER_MS = 5 * 60_000;

function hasStatus(match: ScheduleMatch): boolean {
  return match.actualTime !== undefined || match.winningAlliance !== undefined;
}

function levelOf(match: ScheduleMatch): string {
  return (match.compLevel ?? /_(qm|ef|qf|sf|f)\d/i.exec(match.matchKey)?.[1] ?? "qm").toLowerCase();
}

function toBoardMatch(match: ScheduleMatch): BoardMatch {
  return {
    matchKey: match.matchKey,
    compLevel: levelOf(match),
    matchNumber: match.matchNumber,
    scheduledTime: match.matchTime ?? null,
    red: [],
    blue: [],
    redScore: null,
    blueScore: null,
    winningAlliance: (match.winningAlliance || null) as BoardMatch["winningAlliance"],
    scoutCount: 0,
    plannedTime: match.plannedTime ?? null,
    predictedTime: match.predictedTime ?? null,
    actualTime: match.actualTime ?? null,
    postResultTime: match.postResultTime ?? null,
  };
}

/**
 * Worth opening for a scout: still to come by the rule Home, Event day and the schedule use
 * (isMatchStillAhead — no result, no start, the field has not moved past it, not hours gone),
 * or started in the last few minutes, so the scout finishing it keeps it. A late event no
 * longer skips a match that has not been played just because its planned time has passed.
 */
export function matchOpenForScouting(
  match: ScheduleMatch,
  schedule: readonly ScheduleMatch[],
  now: number = Date.now(),
): boolean {
  if (!hasStatus(match)) {
    const time = match.matchTime ? Date.parse(match.matchTime) : NaN;
    return !Number.isFinite(time) || time >= now - LEGACY_PLAYED_AFTER_MS;
  }
  if (isMatchStillAhead(toBoardMatch(match), schedule.map(toBoardMatch), now)) return true;
  const started = match.actualTime ? Date.parse(match.actualTime) : NaN;
  return Number.isFinite(started) && started >= now - JUST_PLAYED_MS;
}

/**
 * True when every match on the schedule is over, so the card should not call anything "next".
 * With match status: none is still to come. Without it (an old copy on the phone): each is more
 * than three hours past its time, the rule Home and Event day used then.
 */
export function scheduleIsOver(schedule: ScheduleMatch[], now = Date.now()): boolean {
  if (!schedule.length) return false;
  if (schedule.some(hasStatus)) return schedule.every((match) => !matchOpenForScouting(match, schedule, now));
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

/** "Qual 33" / "Semi 2-1" from a match key alone, the way the robot tiles name it. Null if unreadable. */
export function labelForMatchKey(matchKey: string): string | null {
  const parsed = /_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(matchKey.trim());
  if (!parsed) return null;
  const [, level = "qm", first = "0", second] = parsed;
  return matchLabel({ matchKey, compLevel: level.toLowerCase(), matchNumber: Number(second ?? first) });
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
 * Where a scout starts. With match times or status: the first match still open for scouting
 * (matchOpenForScouting) that still has a robot nobody scouted. Starting one past the latest match
 * with any entry sent every scout to Qual 34 because of one stray entry on Qual 33, while Qual 31
 * to 33 were still to play. Without either (an offseason event typed in by hand), the old rule:
 * one past the latest match with scouting.
 */
function startIndex(schedule: ScheduleMatch[], scouted: ScoutedEntry[], now: number): number {
  const timed =
    schedule.some(hasStatus) ||
    schedule.some((match) => match.matchTime && Number.isFinite(Date.parse(match.matchTime)));
  if (timed) {
    const done = new Set(scouted.map((entry) => `${entry.matchKey}|${entry.teamKey}`));
    for (let index = 0; index < schedule.length; index++) {
      const match = schedule[index]!;
      if (!matchOpenForScouting(match, schedule, now)) continue;
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
