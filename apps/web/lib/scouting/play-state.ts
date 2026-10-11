/**
 * "Has this match been played?" — one answer for every scouting screen.
 *
 * The lead card on Scouting home said a match was played once both scores were posted; the
 * Assignments board used the app's "next match" rule, which also calls a match over three
 * hours after its scheduled time. With an event (or its results feed) running late the two
 * screens disagreed on the same morning: "30 robots need a scout" on one, "0 upcoming, 66
 * never scouted, too late to watch live" on the other, and the scout's own "Your robots" list
 * hid the robots they had just been given.
 *
 * Scouting asks a narrower question than "which match is next for our robot": can someone
 * still watch it? A match is played once it has a result or a start time, or (a qualification
 * match) once the field has started a later one. Anything else is still ahead, however late —
 * a match nobody has played can still be scouted. The lead card, the Assignments board, the
 * Quick scout picker and Scouting home all use this.
 *
 * Pure, so it is tested.
 */

export type PlayStateMatch = {
  matchKey: string;
  matchNumber: number;
  compLevel?: string | null;
  /** Posted alliance scores, when the reader has them (the servers do). */
  redScore?: number | null;
  blueScore?: number | null;
  winningAlliance?: string | null;
  postResultTime?: string | null;
  actualTime?: string | null;
};

function levelOf(match: Pick<PlayStateMatch, "compLevel" | "matchKey">): string {
  return (match.compLevel ?? /_(qm|ef|qf|sf|f)\d/i.exec(match.matchKey)?.[1] ?? "qm").toLowerCase();
}

/** The field has run it: a result, a posted result time, or a start time. */
export function matchHasStarted(match: PlayStateMatch): boolean {
  return (
    (match.redScore != null && match.blueScore != null) ||
    Boolean(match.winningAlliance) ||
    Boolean(match.postResultTime) ||
    Boolean(match.actualTime)
  );
}

/**
 * Played (too late to watch live) or still ahead. A qualification match the field skipped
 * past counts as played even when its own result never arrived.
 */
export function isMatchPlayed(match: PlayStateMatch, schedule: readonly PlayStateMatch[]): boolean {
  if (matchHasStarted(match)) return true;
  if (levelOf(match) !== "qm") return false;
  return schedule.some((other) => levelOf(other) === "qm" && other.matchNumber > match.matchNumber && matchHasStarted(other));
}

/** Match keys that are played, in one pass over the schedule. */
export function playedMatchKeys(schedule: readonly PlayStateMatch[]): Set<string> {
  let latestStartedQual = -Infinity;
  for (const match of schedule) {
    if (levelOf(match) === "qm" && matchHasStarted(match)) latestStartedQual = Math.max(latestStartedQual, match.matchNumber);
  }
  const played = new Set<string>();
  for (const match of schedule) {
    if (matchHasStarted(match) || (levelOf(match) === "qm" && match.matchNumber < latestStartedQual)) played.add(match.matchKey);
  }
  return played;
}
