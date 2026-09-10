// Schedule reads TBA only through Neon cache (`matches_ref`).
//
// Event-day refresh polls that cache — never TBA directly, never invented qual
// slots. Polling is non-overlapping and pauses while the tab is hidden so pit
// tablets do not stack requests on a backgrounded page.

import type { ScheduleContext, ScheduleMatch, ScheduleView } from "../schedule-board";

/** Event-day cadence. At least 15s so venue Wi-Fi / tablet batteries are not hammered. */
export const SCHEDULE_POLL_MS = 30_000;

/**
 * Start a cache refresh only when the tab is visible and no request is in flight.
 * `hidden` pauses; missing visibility (SSR / older engines) still refreshes.
 */
export function shouldRefreshSchedule(input: {
  visibilityState?: string | null;
  inFlight?: boolean;
  pauseWhenHidden?: boolean;
}): boolean {
  if (input.inFlight) return false;
  if ((input.pauseWhenHidden ?? true) && input.visibilityState === "hidden") return false;
  return true;
}

export type TbaAllianceJson = {
  teamKeys?: unknown;
  team_keys?: unknown;
  score?: unknown;
} | null;

/** Raw `matches_ref` row as the schedule route selects it. */
export type TbaMatchCacheRow = {
  matchKey: string | null;
  compLevel: string | null;
  matchNumber: number | null;
  scheduledTime: string | null;
  redAlliance: TbaAllianceJson;
  blueAlliance: TbaAllianceJson;
  winningAlliance: string | null;
  scoutCount?: number | null;
  syncedAt?: string | null;
};

export type ScheduleCacheKind = "setup" | "cache_required" | "ready";

/** Alliance team keys from TBA JSON — empty array when the cache omitted them, never padded. */
export function allianceTeamKeys(alliance: TbaAllianceJson): string[] {
  const keys = alliance?.teamKeys ?? alliance?.team_keys;
  if (!Array.isArray(keys)) return [];
  return keys
    .map((key) => String(key).trim())
    .filter((key) => key.length > 0);
}

/** Alliance score from TBA JSON — null until the cache has a finite score. */
export function allianceScore(alliance: TbaAllianceJson): number | null {
  const score = alliance?.score;
  if (score == null || score === "") return null;
  const parsed = Number(score);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Map cached TBA match rows onto the schedule board.
 * Skips incomplete rows. Does not invent missing quals or pad alliances to 3.
 */
export function mapTbaScheduleMatches(rows: readonly TbaMatchCacheRow[]): ScheduleMatch[] {
  const matches: ScheduleMatch[] = [];
  for (const row of rows) {
    if (!row.matchKey || !row.compLevel || row.matchNumber == null) continue;
    const matchNumber = Number(row.matchNumber);
    if (!Number.isFinite(matchNumber)) continue;
    matches.push({
      matchKey: row.matchKey,
      compLevel: row.compLevel,
      matchNumber,
      scheduledTime: row.scheduledTime,
      red: allianceTeamKeys(row.redAlliance),
      blue: allianceTeamKeys(row.blueAlliance),
      redScore: allianceScore(row.redAlliance),
      blueScore: allianceScore(row.blueAlliance),
      winningAlliance:
        row.winningAlliance === "red" || row.winningAlliance === "blue" ? row.winningAlliance : null,
      scoutCount: row.scoutCount == null ? 0 : Number(row.scoutCount) || 0,
    });
  }
  return matches;
}

/**
 * Event selected but Neon has no `matches_ref` rows → cache_required (blank board).
 * No event / no org → setup. Never a ready board of invented slots.
 */
export function classifyScheduleCache(input: {
  eventKey?: string | null;
  matchCount: number;
}): ScheduleCacheKind {
  if (!input.eventKey) return "setup";
  if (input.matchCount <= 0) return "cache_required";
  return "ready";
}

export function scheduleCacheRequiredCopy(): { title: string; description: string } {
  return {
    title: "No matches synced for this event yet",
    description:
      "Once the schedule is posted and TBA cache has rows, matches appear here automatically.",
  };
}

/** Assemble the schedule API view from membership context + cache rows. */
export function buildScheduleView(input: {
  context: ScheduleContext;
  rows?: readonly TbaMatchCacheRow[];
  setupMessage?: string;
}): ScheduleView {
  if (!input.context.orgId) {
    return {
      status: "setup_required",
      context: input.context,
      message: input.setupMessage ?? "Select a team to view the match schedule.",
    };
  }
  if (!input.context.eventKey) {
    return {
      status: "setup_required",
      context: input.context,
      message: input.setupMessage ?? "Select an active event in Workspace.",
    };
  }
  return {
    status: "ready",
    context: input.context,
    matches: mapTbaScheduleMatches(input.rows ?? []),
  };
}
