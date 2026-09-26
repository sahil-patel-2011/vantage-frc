/**
 * What the scout is looking at, in words: "1323 · Qual 10 · Red 2".
 *
 * The robot tiles sit well above the form on a phone, so once a scout has
 * tapped one and scrolled down to count, nothing on screen said which robot
 * they were counting for. These helpers name the pick for the sticky bar over
 * the form and for the confirmation after Save, and decide what comes next.
 * Every name comes from the schedule or the scout's own pick; when the
 * schedule does not say (a typed team, an unpublished alliance) the station
 * and the next match are left out rather than guessed. Pure, so it is tested.
 */

import { matchLabel, orderedSchedule, type ScheduleMatch } from "./next-match";
import { nextAssignedTarget, type SteppableAssignment } from "./next-assignment";
import { describeMatchKey } from "./scout-target";

export type RobotStation = { alliance: "red" | "blue"; station: 1 | 2 | 3 };

export type ScoutContext = {
  /** "1323" — never the frc prefix. */
  teamNumber: string;
  /** "Qual 10"; the raw key only when it is not a key we can read. */
  matchLabel: string | null;
  /** "Red 2" when the schedule places this robot in this match. */
  stationLabel: string | null;
};

export type NextScoutTarget = {
  matchKey: string;
  /** Empty when the next match is known but its robots are not. */
  teamKey: string;
  matchLabel: string;
  stationLabel: string | null;
  /** Your next assignment, or the same station in the next scheduled match. */
  reason: "assignment" | "station" | "match";
};

export function teamNumberOf(teamKey: string): string {
  return teamKey.trim().replace(/^frc/i, "");
}

export function stationLabel(slot: RobotStation | null): string | null {
  if (!slot) return null;
  return `${slot.alliance === "red" ? "Red" : "Blue"} ${slot.station}`;
}

/** Where a robot stands in a match, from the published alliances. */
export function robotStation(match: ScheduleMatch | undefined, teamKey: string): RobotStation | null {
  if (!match || !teamKey) return null;
  const red = match.redAlliance?.teamKeys ?? [];
  const blue = match.blueAlliance?.teamKeys ?? [];
  const inRed = red.slice(0, 3).indexOf(teamKey);
  if (inRed >= 0) return { alliance: "red", station: (inRed + 1) as 1 | 2 | 3 };
  const inBlue = blue.slice(0, 3).indexOf(teamKey);
  if (inBlue >= 0) return { alliance: "blue", station: (inBlue + 1) as 1 | 2 | 3 };
  return null;
}

function labelFor(matches: readonly ScheduleMatch[], matchKey: string): string | null {
  if (!matchKey) return null;
  const scheduled = matches.find((match) => match.matchKey === matchKey);
  if (scheduled) return matchLabel(scheduled);
  // A typed match is not on the schedule; read its key the way the robot
  // tiles label a scheduled one ("Qual 7", not "Qualification 7").
  const parsed = /_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(matchKey.trim());
  if (!parsed) return describeMatchKey(matchKey);
  const [, level = "qm", first = "0", second] = parsed;
  return matchLabel({ matchKey, compLevel: level.toLowerCase(), matchNumber: Number(second ?? first) });
}

export function scoutContext(input: {
  matches: readonly ScheduleMatch[];
  matchKey: string;
  teamKey: string;
}): ScoutContext | null {
  const teamNumber = teamNumberOf(input.teamKey);
  if (!teamNumber) return null;
  const match = input.matches.find((candidate) => candidate.matchKey === input.matchKey);
  return {
    teamNumber,
    matchLabel: labelFor(input.matches, input.matchKey),
    stationLabel: stationLabel(robotStation(match, input.teamKey)),
  };
}

/** "1323 · Qual 10 · Red 2", dropping whichever part is unknown. */
export function describeScoutContext(context: ScoutContext): string {
  return [context.teamNumber, context.matchLabel, context.stationLabel].filter(Boolean).join(" · ");
}

/**
 * After a match is saved: the scout's next assignment when there is one;
 * otherwise the next match on the schedule, at the same station, because a
 * scout watching Red 2 is usually still watching Red 2. Null when the saved
 * match is not on the schedule, so nothing is named that the schedule does
 * not actually say.
 */
export function nextScoutTarget(input: {
  matches: readonly ScheduleMatch[];
  assignments: readonly SteppableAssignment[];
  savedMatchKey: string;
  savedTeamKey: string;
  /** Robots this scout already has a report for: "Next" opened one, and Save would replace it. */
  done?: (matchKey: string, teamKey: string) => boolean;
}): NextScoutTarget | null {
  const assigned = nextAssignedTarget(input.assignments, input.savedMatchKey, input.done);
  if (assigned) {
    const match = input.matches.find((candidate) => candidate.matchKey === assigned.matchKey);
    return {
      matchKey: assigned.matchKey,
      teamKey: assigned.teamKey,
      matchLabel: labelFor(input.matches, assigned.matchKey) ?? assigned.matchKey,
      stationLabel: stationLabel(robotStation(match, assigned.teamKey)),
      reason: "assignment",
    };
  }
  const schedule = orderedSchedule([...input.matches]);
  const index = schedule.findIndex((match) => match.matchKey === input.savedMatchKey);
  if (index < 0 || !schedule[index + 1]) return null;
  const slot = robotStation(schedule[index], input.savedTeamKey);
  const done = input.done ?? (() => false);
  // The same station in the next match, unless this scout already has that robot; then another
  // robot in that match they have not done (same alliance first), then the match after.
  for (const next of schedule.slice(index + 1)) {
    const own = slot ? next[slot.alliance === "red" ? "redAlliance" : "blueAlliance"]?.teamKeys ?? [] : [];
    const sameStation = slot ? own[slot.station - 1] : undefined;
    if (slot && sameStation && !done(next.matchKey, sameStation)) {
      return {
        matchKey: next.matchKey,
        teamKey: sameStation,
        matchLabel: matchLabel(next),
        stationLabel: stationLabel(slot),
        reason: "station",
      };
    }
    if (!slot) break;
    const other = slot.alliance === "red" ? next.blueAlliance?.teamKeys ?? [] : next.redAlliance?.teamKeys ?? [];
    const open = [...own, ...other].find((teamKey) => teamKey && !done(next.matchKey, teamKey));
    if (open) {
      return {
        matchKey: next.matchKey,
        teamKey: open,
        matchLabel: matchLabel(next),
        stationLabel: stationLabel(robotStation(next, open)),
        reason: "station",
      };
    }
  }
  const next = schedule[index + 1]!;
  return { matchKey: next.matchKey, teamKey: "", matchLabel: matchLabel(next), stationLabel: null, reason: "match" };
}

/**
 * The line after an upload. "Synced 1 entries and 0 media files" counted
 * nothing twice and got the plural wrong; this names only what moved.
 */
export function syncSummary(input: { entries: number; media: number }): string | null {
  const parts: string[] = [];
  if (input.entries > 0) parts.push(`${input.entries} ${input.entries === 1 ? "entry" : "entries"}`);
  if (input.media > 0) parts.push(`${input.media} ${input.media === 1 ? "photo or video" : "photos and videos"}`);
  return parts.length ? `Uploaded ${parts.join(" and ")}` : null;
}
