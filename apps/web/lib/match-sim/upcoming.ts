import type { ScheduleMatch } from "../schedule-board";
import { matchKeyLabel } from "../scouting/scout-breakdown";

/**
 * "Which match do you want to predict?" answered from the schedule, so nobody at an
 * event types six team numbers on a phone.
 *
 * The next unplayed matches in field order, plus — if it is further out than that —
 * the team's own next match, because that is the one the drive team is asking about.
 */
export type UpcomingPick = {
  matchKey: string;
  label: string;
  scheduledTime: string | null;
  red: string[];
  blue: string[];
  /** Which alliance the viewing team is on, when it plays in this match. */
  ours: "red" | "blue" | null;
  /** From the schedule's own estimate; null when a robot has no rating yet. */
  redWinPct: number | null;
};

const LEVEL_ORDER: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };

function fieldOrder(a: ScheduleMatch, b: ScheduleMatch): number {
  const level = (LEVEL_ORDER[a.compLevel] ?? 9) - (LEVEL_ORDER[b.compLevel] ?? 9);
  if (level !== 0) return level;
  const set = (a.setNumber ?? 0) - (b.setNumber ?? 0);
  if (set !== 0) return set;
  return a.matchNumber - b.matchNumber;
}

/**
 * A match with no posted score is still "upcoming" only if its time has not long passed:
 * a match that ran ten minutes ago whose score TBA has not posted yet is over, and an
 * abandoned one from yesterday is not the next thing to predict. Event Day uses the same
 * clock (lib/command/load-command.ts).
 */
const STALE_AFTER_MS = 30 * 60_000;

export function upcomingMatchPicks(
  matches: ScheduleMatch[],
  teamKey: string | null,
  limit = 6,
  now: Date = new Date(),
): UpcomingPick[] {
  const cutoff = now.getTime() - STALE_AFTER_MS;
  const unplayed = matches
    .filter((match) => (match.redScore == null || match.blueScore == null) && match.red.length > 0 && match.blue.length > 0)
    .filter((match) => {
      const at = match.scheduledTime ? Date.parse(match.scheduledTime) : Number.NaN;
      return Number.isNaN(at) || at >= cutoff;
    })
    .sort(fieldOrder);
  const chosen = unplayed.slice(0, Math.max(0, limit));
  if (teamKey && !chosen.some((match) => match.red.includes(teamKey) || match.blue.includes(teamKey))) {
    const ourNext = unplayed.find((match) => match.red.includes(teamKey) || match.blue.includes(teamKey));
    if (ourNext) chosen.push(ourNext);
  }
  return chosen.map((match) => ({
    matchKey: match.matchKey,
    label: matchKeyLabel(match.matchKey),
    scheduledTime: match.scheduledTime,
    red: match.red,
    blue: match.blue,
    ours: teamKey ? (match.red.includes(teamKey) ? "red" : match.blue.includes(teamKey) ? "blue" : null) : null,
    redWinPct: match.prediction?.redWinPct ?? null,
  }));
}

/** The event key a TBA match key belongs to ("2026casj_qm12" → "2026casj"). */
export function eventKeyOfMatch(matchKey: string): string | null {
  const cut = matchKey.indexOf("_");
  return cut > 0 ? matchKey.slice(0, cut) : null;
}
