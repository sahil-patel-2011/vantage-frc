// One event match timeline — the pure half behind /schedule.
//
// A scouting lead runs the day off one list: what is on the field, who is
// watching each robot, whether the entries came in, and what is next. Before
// this, that answer was split across Schedule (matches), Lineup (who is
// assigned), Coverage (entries), Match notes and the Video index. This module
// joins those rows onto the schedule the board already renders, and decides
// which match is "now".
//
// Framework-free and I/O-free: the API route feeds it rows, the client and the
// unit tests call it directly. Nothing here invents a time, a score or a scout.

import { isScored, type ScheduleMatch } from "../schedule-board";
import { isBackupRole } from "../scouting/assignment-accountability";

export type TimelineAssignee = {
  userId: string;
  name: string;
  role: "primary" | "backup";
  /** This person has at least one entry for this match + robot. */
  submitted: boolean;
  /**
   * Results are posted and this person's entry never arrived. A backup only
   * counts as missed when every primary for the robot also missed — a backup
   * is there in case, not as a second duty.
   */
  missed: boolean;
};

export type TimelineRobot = {
  teamKey: string;
  alliance: "red" | "blue";
  /** 1–3 driver-station slot, from alliance order. */
  station: number;
  assignees: TimelineAssignee[];
  /** Entries by anyone for this match + robot. */
  entryCount: number;
};

export type TimelineVideo = {
  url: string;
  /** "team": someone on the team indexed it. "tba": the event's official upload. */
  source: "team" | "tba";
};

export type TimelineAssignmentRow = {
  matchKey: string;
  teamKey: string;
  userId: string;
  name: string | null;
  role: string | null;
};

export type TimelineEntryRow = {
  matchKey: string;
  teamKey: string;
  scoutUserId: string;
  count: number | string;
};

export type TimelineCountRow = { matchKey: string; count: number | string };
export type TimelineVideoRow = { matchKey: string; url: string | null };

/** How long a match stays "on field now" after its scheduled / predicted start. */
export const NOW_WINDOW_MS = 8 * 60 * 1000;
/** Unplayed matches after "now" that sit in the Up next group. */
export const UP_NEXT_COUNT = 3;

const LEVEL_SHORT: Record<string, string> = { qm: "Q", ef: "EF", qf: "QF", sf: "SF", f: "F" };

/**
 * The label a scout says out loud: Q12, SF2-1, F2.
 *
 * Playoff matches carry a set and a match number; a final's set is always 1,
 * so "F1-2" is written the way the field announcer says it, "F2".
 */
export function shortMatchLabel(compLevel: string, setNumber: number | null | undefined, matchNumber: number): string {
  const level = (compLevel || "").toLowerCase();
  const prefix = LEVEL_SHORT[level] ?? (level ? level.toUpperCase() : "M");
  if (level === "qm") return `${prefix}${matchNumber}`;
  const set = setNumber != null && Number.isFinite(setNumber) && setNumber > 0 ? setNumber : null;
  if (level === "f" && (set == null || set === 1)) return `${prefix}${matchNumber}`;
  return set == null ? `${prefix}${matchNumber}` : `${prefix}${set}-${matchNumber}`;
}

/** Played = TBA posted scores, or the field recorded when it ran. */
export function isPlayed(match: ScheduleMatch): boolean {
  return isScored(match) || Boolean(match.actualTime);
}

/** The time a match is expected to start — TBA's live estimate first, then the published slot. */
export function expectedStart(match: ScheduleMatch): string | null {
  return match.predictedTime ?? match.plannedTime ?? (match.actualTime ? null : match.scheduledTime) ?? null;
}

function parseTime(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** Only http(s) links are rendered — anything else in a stored URL is not a video link. */
export function safeVideoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** TBA's `videos` array is [{ type, key }]. Only YouTube has a stable public URL. */
export function tbaVideoUrl(type: string | null | undefined, key: string | null | undefined): string | null {
  if (!type || !key) return null;
  if (type.toLowerCase() !== "youtube") return null;
  const clean = key.trim();
  if (!/^[\w-]{6,20}(?:\?t=\d+)?$/.test(clean)) return null;
  return `https://www.youtube.com/watch?v=${clean.replace("?t=", "&t=")}`;
}

function key(matchKey: string, teamKey: string): string {
  return `${matchKey}|${teamKey}`;
}

/**
 * Join assignments, entry counts, notes and videos onto the schedule.
 *
 * One pass per source, keyed maps, no per-match lookups against the database.
 * `scoutCount` becomes the number of submitted entries for the match — the CSV
 * column already promised "Submitted scouting rows for this match", and it was
 * counting assignments.
 */
export function attachTimelineDetail(
  matches: readonly ScheduleMatch[],
  input: {
    assignments?: readonly TimelineAssignmentRow[];
    entries?: readonly TimelineEntryRow[];
    notes?: readonly TimelineCountRow[];
    videos?: readonly TimelineVideoRow[];
  },
): ScheduleMatch[] {
  const assignmentsByRobot = new Map<string, TimelineAssignmentRow[]>();
  for (const row of input.assignments ?? []) {
    const id = key(row.matchKey, row.teamKey);
    const list = assignmentsByRobot.get(id);
    if (list) list.push(row);
    else assignmentsByRobot.set(id, [row]);
  }
  const entriesByRobot = new Map<string, number>();
  const submitted = new Set<string>();
  for (const row of input.entries ?? []) {
    const count = Number(row.count) || 0;
    if (count <= 0) continue;
    const id = key(row.matchKey, row.teamKey);
    entriesByRobot.set(id, (entriesByRobot.get(id) ?? 0) + count);
    submitted.add(`${id}|${row.scoutUserId}`);
  }
  const notesByMatch = new Map<string, number>();
  for (const row of input.notes ?? []) notesByMatch.set(row.matchKey, (notesByMatch.get(row.matchKey) ?? 0) + (Number(row.count) || 0));
  const teamVideo = new Map<string, string>();
  for (const row of input.videos ?? []) {
    const url = safeVideoUrl(row.url);
    if (url && !teamVideo.has(row.matchKey)) teamVideo.set(row.matchKey, url);
  }

  return matches.map((match) => {
    const resultsPosted = isScored(match);
    const robots: TimelineRobot[] = [];
    let total = 0;
    for (const alliance of ["red", "blue"] as const) {
      match[alliance].forEach((teamKey, index) => {
        const id = key(match.matchKey, teamKey);
        const rows = assignmentsByRobot.get(id) ?? [];
        const withStatus = rows.map((row) => ({
          userId: row.userId,
          name: row.name?.trim() || "Team member",
          role: isBackupRole(row.role) ? ("backup" as const) : ("primary" as const),
          submitted: submitted.has(`${id}|${row.userId}`),
        }));
        const primaries = withStatus.filter((row) => row.role === "primary");
        const anyPrimarySubmitted = primaries.some((row) => row.submitted);
        const assignees: TimelineAssignee[] = withStatus
          .map((row) => ({
            ...row,
            missed:
              resultsPosted &&
              !row.submitted &&
              (row.role === "primary" || !anyPrimarySubmitted),
          }))
          // Primaries first — the backup is the fallback, and reads that way.
          .sort((a, b) => (a.role === b.role ? a.name.localeCompare(b.name) : a.role === "primary" ? -1 : 1));
        const entryCount = entriesByRobot.get(id) ?? 0;
        total += entryCount;
        robots.push({ teamKey, alliance, station: index + 1, assignees, entryCount });
      });
    }
    const tba = match.video?.source === "tba" ? match.video : null;
    const team = teamVideo.get(match.matchKey);
    return {
      ...match,
      robots,
      scoutCount: total,
      noteCount: notesByMatch.get(match.matchKey) ?? 0,
      video: team ? { url: team, source: "team" as const } : tba,
    };
  });
}

export type TimelineGroups = {
  played: ScheduleMatch[];
  now: ScheduleMatch | null;
  upNext: ScheduleMatch[];
  later: ScheduleMatch[];
};

/**
 * Split the schedule into Played / On field now / Up next / Later.
 *
 * "Now" is the earliest unplayed match whose expected start fell within the
 * last ~8 minutes; failing that, the first unplayed match in schedule order.
 * Field delays make wall-clock alone wrong, and schedule order alone wrong the
 * morning a match is replayed, so it takes the clock when the clock is sure.
 *
 * An unplayed match that sits before "now" (its time passed long ago and no
 * result ever arrived) stays in Up next — it has not been played as far as
 * anyone knows, and filing it under Played would imply a result.
 */
export function groupTimeline(
  matches: readonly ScheduleMatch[],
  now: number = Date.now(),
  options: { windowMs?: number; upNextCount?: number } = {},
): TimelineGroups {
  const windowMs = options.windowMs ?? NOW_WINDOW_MS;
  const upNextCount = options.upNextCount ?? UP_NEXT_COUNT;
  const played: ScheduleMatch[] = [];
  const unplayed: ScheduleMatch[] = [];
  for (const match of matches) (isPlayed(match) ? played : unplayed).push(match);

  let nowIndex = unplayed.findIndex((match) => {
    const start = parseTime(expectedStart(match));
    return start != null && start <= now && start >= now - windowMs;
  });
  if (nowIndex < 0) nowIndex = unplayed.length > 0 ? 0 : -1;
  if (nowIndex < 0) return { played, now: null, upNext: [], later: [] };

  const stale = unplayed.slice(0, nowIndex);
  const after = unplayed.slice(nowIndex + 1);
  return {
    played,
    now: unplayed[nowIndex] ?? null,
    upNext: [...stale, ...after.slice(0, upNextCount)],
    later: after.slice(upNextCount),
  };
}

export type TimelineFilter = "all" | "ours" | "mine";

/** Does this match pass the board filter? */
export function matchPassesFilter(
  match: ScheduleMatch,
  filter: TimelineFilter,
  who: { teamKey: string | null; userId: string | null },
): boolean {
  if (filter === "all") return true;
  if (filter === "ours") {
    return who.teamKey != null && (match.red.includes(who.teamKey) || match.blue.includes(who.teamKey));
  }
  if (!who.userId) return false;
  return (match.robots ?? []).some((robot) => robot.assignees.some((person) => person.userId === who.userId));
}

/** The viewer's own robot in a match — what "my assignments" rows lead with. */
export function myRobot(match: ScheduleMatch, userId: string | null): { robot: TimelineRobot; role: "primary" | "backup" } | null {
  if (!userId) return null;
  for (const robot of match.robots ?? []) {
    const mine = robot.assignees.find((person) => person.userId === userId);
    if (mine) return { robot, role: mine.role };
  }
  return null;
}

/** The viewer's next unplayed assignment, primary first, in schedule order. */
export function nextMyAssignment(
  matches: readonly ScheduleMatch[],
  userId: string | null,
): { match: ScheduleMatch; robot: TimelineRobot; role: "primary" | "backup" } | null {
  if (!userId) return null;
  let backup: { match: ScheduleMatch; robot: TimelineRobot; role: "primary" | "backup" } | null = null;
  for (const match of matches) {
    if (isPlayed(match)) continue;
    const mine = myRobot(match, userId);
    if (!mine) continue;
    if (mine.role === "primary") return { match, ...mine };
    backup ??= { match, ...mine };
  }
  return backup;
}

/** Robots in a played match whose assigned scout never submitted. */
export function missedCount(match: ScheduleMatch): number {
  return (match.robots ?? []).reduce(
    (sum, robot) => sum + robot.assignees.filter((person) => person.missed).length,
    0,
  );
}
