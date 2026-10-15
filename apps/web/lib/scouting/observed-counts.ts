import type { ObservedRobot } from "./team-profiles";

/**
 * Robot-matches with at least one report: one per (team, match), however many scouts watched
 * it. The same unit Assignments counts ("12 of 384 robot-matches"), so the two pages agree;
 * reports without a match key (pit or untagged notes) are not matches and are not counted.
 */
export function robotMatchesScouted(robots: readonly ObservedRobot[]): number {
  const seen = new Set<string>();
  for (const robot of robots) {
    for (const report of robot.reports) {
      if (report.matchKey) seen.add(`${robot.teamKey}|${report.matchKey}`);
    }
  }
  return seen.size;
}

/** "9 robots · 12 matches scouted" — both numbers, so neither reads as the other. */
export function watchedSummary(robots: readonly ObservedRobot[]): string {
  const matches = robotMatchesScouted(robots);
  const robotWord = robots.length === 1 ? "robot" : "robots";
  const matchWord = matches === 1 ? "match" : "matches";
  return `${robots.length} ${robotWord} · ${matches} ${matchWord} scouted`;
}
