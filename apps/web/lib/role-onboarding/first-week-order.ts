/**
 * One order for a person's first steps, shared by the onboarding done screen and Home's
 * "Your first week" card. They used to sort differently, so a student finished onboarding
 * with "Open Scouting, Claim a todo, See this week" and landed on Home's "Open Event day".
 *
 * Leaf module on purpose: it is bundled into client components.
 */

/** The team's own setup (owners and admins) first, then the person's crew, focus, role, and the welcome tour. */
const SOURCE_ORDER: Record<string, number> = { subteam: 0, focus: 1, role: 2, manual: 3, welcome: 4 };

/** Lead jobs a student or parent is not sent to in their first week. */
export const LEAD_ONLY_PATHS = [
  "/scouting/lineup",
  "/scouting?scoutTab=conflicts",
  "/command",
  "/team/admin",
  "/team/security",
];

export function isMemberRole(teamRole: string | null | undefined): boolean {
  return teamRole === "student" || teamRole === "parent";
}

/** Crew and subteam paths, whichever way they were matched (crew pick, description, calendar). */
const SPECIALTY_TRACKS = new Set(["mechanical", "electrical", "programming", "cad", "drive_team", "scouting", "business", "safety"]);

/** Team setup, then the person's crew, focus, role, and the welcome tour last. */
export function firstWeekTrackRank(track: { key: string; source: string }): number {
  if (track.key === "team_setup") return -1;
  if (SPECIALTY_TRACKS.has(track.key)) return 0;
  if (track.key.startsWith("focus_")) return 1;
  if (track.key.startsWith("role_")) return 2;
  if (track.key === "welcome") return 4;
  return SOURCE_ORDER[track.source] ?? 3;
}

type Check = { href?: string | null };
type Track = { key: string; source: string; checks: Check[] };

/**
 * One step from each list in turn, most specific list first, skipping lead-only pages for
 * students and parents and anything `skip` rules out (already done, for example).
 */
export function pickFirstWeek<T extends Track>(
  tracks: T[],
  options: { limit: number; member: boolean; skip?: (check: T["checks"][number]) => boolean },
): Array<{ track: T; check: T["checks"][number] }> {
  type C = T["checks"][number];
  const allowed = (check: C) =>
    !options.skip?.(check) && !(options.member && check.href && LEAD_ONLY_PATHS.some((path) => check.href!.startsWith(path)));
  const queues = [...tracks]
    .sort((a, b) => firstWeekTrackRank(a) - firstWeekTrackRank(b))
    .map((track) => ({ track, checks: track.checks.filter(allowed) }));
  const out: Array<{ track: T; check: C }> = [];
  const seen = new Set<string>();
  while (out.length < options.limit && queues.some((queue) => queue.checks.length > 0)) {
    for (const queue of queues) {
      const check = queue.checks.shift();
      if (!check) continue;
      // The same page offered by two lists is one step.
      const page = check.href?.split("?")[0];
      if (page && seen.has(page)) continue;
      if (page) seen.add(page);
      out.push({ track: queue.track, check });
      if (out.length >= options.limit) break;
    }
  }
  return out;
}
