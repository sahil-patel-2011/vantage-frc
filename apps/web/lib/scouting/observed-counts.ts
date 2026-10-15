import type { ObservedRobot } from "./team-profiles";
import { robotsAndMatchesLabel, scoutingTotalsLabel, type ScoutingTotals } from "./scouted-counts";

/**
 * Robot-matches with at least one report: one per (team, match), however many scouts watched
 * it. The same unit as `ScoutingTotals.robotMatches` (scouted-counts.ts) and Assignments'
 * "12 of 384 robot-matches"; reports without a match key (pit or untagged notes) are not
 * matches and are not counted.
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

/**
 * "9 robots · 12 matches scouted" — both numbers, so neither reads as the other.
 *
 * The server's event totals win when it sent them (the one definition every screen shares);
 * counting the observations here is the fallback for a copy saved before totals existed.
 */
export function watchedSummary(robots: readonly ObservedRobot[], totals?: ScoutingTotals | null): string {
  if (totals) return scoutingTotalsLabel(totals);
  return robotsAndMatchesLabel(robots.length, robotMatchesScouted(robots));
}
