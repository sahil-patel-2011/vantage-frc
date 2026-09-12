// Rankings reads TBA / Statbotics only through Neon cache
// (`team_event_metrics` + playoff rows on `matches_ref`).
//
// Event-day refresh polls that cache — never live TBA, never invented ranks or
// bracket slots. Polling is non-overlapping and pauses while the tab is hidden.

import {
  formatRecord,
  parsePlayoffLabel,
  sortRanked,
  teamNumberFromKey,
  type PlayoffMatch,
  type RankedTeam,
  type RankingsContext,
  type RankingsView,
} from "../rankings";
import {
  allianceScore,
  allianceTeamKeys,
  type TbaAllianceJson,
  type TbaMatchCacheRow,
} from "../schedule/tba-cache";

/** Event-day cadence. At least 15s so venue Wi-Fi / tablet batteries are not hammered. */
export const RANKINGS_POLL_MS = 30_000;

const PLAYOFF_LEVELS = new Set(["ef", "qf", "sf", "f"]);

/**
 * Start a cache refresh only when the tab is visible and no request is in flight.
 * `hidden` pauses; missing visibility (SSR / older engines) still refreshes.
 */
export function shouldRefreshRankings(input: {
  visibilityState?: string | null;
  inFlight?: boolean;
  pauseWhenHidden?: boolean;
}): boolean {
  if (input.inFlight) return false;
  if ((input.pauseWhenHidden ?? true) && input.visibilityState === "hidden") return false;
  return true;
}

/** Raw `team_event_metrics` row as the rankings route selects it. */
export type TbaRankCacheRow = {
  teamKey: string | null;
  nickname: string | null;
  rank: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  epaTotal: number | null;
  epaAuto: number | null;
  epaTeleop: number | null;
  epaEndgame: number | null;
  source: string | null;
  syncedAt?: string | null;
};

export type RankingsCacheKind = "setup" | "cache_required" | "ready";

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Map cached team-event metrics. Rank stays null until the cache row has one —
 * never assigned from array index or a typical 24-team field.
 */
export function mapTbaRankedTeams(rows: readonly TbaRankCacheRow[]): RankedTeam[] {
  const teams: RankedTeam[] = [];
  for (const row of rows) {
    if (!row.teamKey) continue;
    teams.push({
      teamKey: row.teamKey,
      teamNumber: teamNumberFromKey(row.teamKey),
      nickname: row.nickname,
      rank: finiteOrNull(row.rank),
      record: formatRecord(
        finiteOrNull(row.wins),
        finiteOrNull(row.losses),
        finiteOrNull(row.ties),
      ),
      epaTotal: finiteOrNull(row.epaTotal),
      epaAuto: finiteOrNull(row.epaAuto),
      epaTeleop: finiteOrNull(row.epaTeleop),
      epaEndgame: finiteOrNull(row.epaEndgame),
      source: row.source,
    });
  }
  return teams;
}

/**
 * Map cached playoff rows only. Skips quals and incomplete keys.
 * Does not invent a QF/SF/Final bracket when the cache is empty.
 */
export function mapTbaPlayoffMatches(rows: readonly TbaMatchCacheRow[]): PlayoffMatch[] {
  const playoffs: PlayoffMatch[] = [];
  for (const row of rows) {
    if (!row.matchKey || !row.compLevel || row.matchNumber == null) continue;
    if (!PLAYOFF_LEVELS.has(row.compLevel)) continue;
    const matchNumber = Number(row.matchNumber);
    if (!Number.isFinite(matchNumber)) continue;
    playoffs.push({
      matchKey: row.matchKey,
      compLevel: row.compLevel,
      matchNumber,
      label: parsePlayoffLabel(row.matchKey, row.compLevel, matchNumber),
      red: allianceTeamKeys(row.redAlliance),
      blue: allianceTeamKeys(row.blueAlliance),
      redScore: allianceScore(row.redAlliance),
      blueScore: allianceScore(row.blueAlliance),
      winner: row.winningAlliance === "red" || row.winningAlliance === "blue" ? row.winningAlliance : null,
      scheduledTime: row.scheduledTime,
    });
  }
  return playoffs;
}

/** Later of two synced_at texts (Date compare, lexicographic fallback). */
export function laterSync(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  const a = Date.parse(current);
  const b = Date.parse(candidate);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return b > a ? candidate : current;
  return candidate > current ? candidate : current;
}

export function latestSyncedAt(values: ReadonlyArray<string | null | undefined>): string | null {
  let current: string | null = null;
  for (const value of values) {
    current = laterSync(current, value ?? null);
  }
  return current;
}

/**
 * Event selected but Neon has no ranking cache rows → cache_required (blank).
 * Rank numbers stay off the board until those rows exist — never invented.
 */
export function classifyRankingsCache(input: {
  eventKey?: string | null;
  teamCount: number;
}): RankingsCacheKind {
  if (!input.eventKey) return "setup";
  if (input.teamCount <= 0) return "cache_required";
  return "ready";
}

export function rankingsCacheRequiredCopy(): { title: string; description: string } {
  return {
    title: "Reference metrics not synced yet",
    description: "Sync event numbers under Team → Data to populate event rankings — ranks stay blank until cache rows exist.",
  };
}

/** Assemble the rankings API view from membership context + cache rows. */
export function buildRankingsView(input: {
  context: RankingsContext;
  metricRows?: readonly TbaRankCacheRow[];
  playoffRows?: readonly TbaMatchCacheRow[];
  setupMessage?: string;
}): RankingsView {
  if (!input.context.orgId) {
    return {
      status: "setup_required",
      context: input.context,
      message: input.setupMessage ?? "Choose your team to view event rankings.",
    };
  }
  if (!input.context.eventKey) {
    return {
      status: "setup_required",
      context: input.context,
      message: input.setupMessage ?? "Set your active event on Your team.",
    };
  }

  const metricRows = input.metricRows ?? [];
  const playoffRows = input.playoffRows ?? [];
  const teams = sortRanked(mapTbaRankedTeams(metricRows));
  const playoffs = mapTbaPlayoffMatches(playoffRows);
  const syncedAt = latestSyncedAt([
    ...metricRows.map((row) => row.syncedAt),
    ...playoffRows.map((row) => row.syncedAt),
  ]);

  return { status: "ready", context: input.context, teams, playoffs, syncedAt };
}

export type { TbaAllianceJson, TbaMatchCacheRow };
