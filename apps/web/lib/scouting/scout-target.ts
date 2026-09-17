/**
 * Choosing who to scout.
 *
 * Scouting is not an assignment system here. Anyone on the team can scout any
 * robot, at any moment, by naming it — someone notices a robot doing something
 * odd two fields over and writes it down. Assignments are a convenience for
 * whoever wants a list, not a fence around what may be recorded.
 *
 * The old selector was a fence in two ways. If you had any assignment at all,
 * the dropdown collapsed to only your assignments and the rest of the schedule
 * vanished. And with no synced schedule — every offseason event, and every
 * first morning before the schedule lands — the dropdown was empty and match
 * scouting was impossible. This module fixes both: assignments sort to the top
 * and are marked, everything else stays reachable, and a team number can always
 * be typed in.
 */

export type ScoutAssignment = {
  matchKey: string;
  teamKey: string;
  compLevel: string;
  matchNumber: number;
};

export type ScheduledMatch = {
  matchKey: string;
  matchNumber: number;
  compLevel?: string | null;
  redAlliance?: { teamKeys?: string[] | null } | null;
  blueAlliance?: { teamKeys?: string[] | null } | null;
};

export type ScoutTargetOption = {
  matchKey: string;
  teamKey: string;
  label: string;
  /** True when this row is one of yours. Sorted first and labelled. */
  assigned: boolean;
};

/** "frc254" → "254", for a label a human reads at a glance. */
function teamLabel(teamKey: string): string {
  return teamKey.replace(/^frc/i, "");
}

/**
 * Every robot in the schedule, with your assignments first.
 *
 * Assignments are merged rather than substituted: a scout who has been given
 * three matches can still record the fourth one they happened to watch.
 */
export function buildScoutTargets(input: {
  assignments?: ScoutAssignment[];
  matches?: ScheduledMatch[];
}): ScoutTargetOption[] {
  const assigned = new Set<string>();
  const options: ScoutTargetOption[] = [];

  for (const assignment of input.assignments ?? []) {
    if (!assignment.matchKey || !assignment.teamKey) continue;
    const id = `${assignment.matchKey}|${assignment.teamKey}`;
    if (assigned.has(id)) continue;
    assigned.add(id);
    options.push({
      matchKey: assignment.matchKey,
      teamKey: assignment.teamKey,
      label: `${(assignment.compLevel || "match").toUpperCase()} ${assignment.matchNumber} · ${teamLabel(assignment.teamKey)}`,
      assigned: true,
    });
  }

  for (const match of input.matches ?? []) {
    const teamKeys = [
      ...(match.redAlliance?.teamKeys ?? []),
      ...(match.blueAlliance?.teamKeys ?? []),
    ];
    for (const teamKey of teamKeys) {
      if (!teamKey) continue;
      const id = `${match.matchKey}|${teamKey}`;
      if (assigned.has(id)) continue;
      assigned.add(id);
      options.push({
        matchKey: match.matchKey,
        teamKey,
        label: `${(match.compLevel || "match").toUpperCase()} ${match.matchNumber} · ${teamLabel(teamKey)}`,
        assigned: false,
      });
    }
  }

  return options;
}

/**
 * A typed team number turned into a team key.
 *
 * Accepts what people actually type on a phone in a venue: "254", "frc254",
 * " 254 ", and the B-team suffix that offseason events use. Returns null for
 * anything else rather than guessing, because a wrong team key files scouting
 * against a robot nobody watched.
 */
export function normalizeTeamKey(input: string): string | null {
  const trimmed = input.trim().toLowerCase().replace(/^frc/, "");
  const match = /^(\d{1,5})([a-h])?$/.exec(trimmed);
  if (!match) return null;
  const [, digits = "", suffix] = match;
  const number = Number(digits);
  // Team 0 does not exist, and a leading-zero form like "0254" is a typo we
  // should not silently accept as 254.
  if (number < 1 || digits !== String(number)) return null;
  return `frc${number}${suffix ? suffix.toUpperCase() : ""}`;
}

export const COMP_LEVELS = ["qm", "qf", "sf", "f"] as const;
export type CompLevel = (typeof COMP_LEVELS)[number];

/**
 * The match key for a match nobody has synced, e.g. "2026custom-1a2b-grits_qm7".
 *
 * Same shape The Blue Alliance uses, so an entry typed by hand at an offseason
 * lines up with a synced one if that event is ever imported.
 */
export function manualMatchKey(
  eventKey: string,
  compLevel: CompLevel,
  matchNumber: number,
): string | null {
  if (!eventKey.trim()) return null;
  if (!COMP_LEVELS.includes(compLevel)) return null;
  if (!Number.isInteger(matchNumber) || matchNumber < 1 || matchNumber > 999) return null;
  return `${eventKey.trim()}_${compLevel}${matchNumber}`;
}

/** What to tell someone when the schedule has nothing in it. */
export const NO_SCHEDULE_COPY =
  "No schedule synced for this event yet. Type the team number and match below — scouting does not wait for a schedule.";

/** What to tell someone who has assignments but may scout anything. */
export const ASSIGNMENTS_ARE_SUGGESTIONS_COPY =
  "Your assigned matches are first. You can scout any robot in the list, or type a team number.";
