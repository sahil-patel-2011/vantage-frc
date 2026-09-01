// Watchlist → scouting coverage order.
//
// Opponent Watchlist used to be a dead-end: rows sat in opponent_watchlist_entries and never
// changed the scout queue. This module is the hop — real watchlist team keys become a stable
// priority list that coverage can apply without rewriting the board.

export type WatchlistTeamRow = {
  teamKey: string | null | undefined;
};

export type CoverageOrderSlot = {
  teamKey: string;
};

const UNWATCHED = Number.MAX_SAFE_INTEGER;

/** Canonical `frcNNNN` key, or null when the input is not a real team key. */
export function normalizeWatchlistTeamKey(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const trimmed = String(value).trim().toLowerCase();
  const numbered = /^frc(\d+)$/.exec(trimmed) ?? /^(\d+)$/.exec(trimmed);
  if (!numbered) return null;
  return `frc${numbered[1]}`;
}

/**
 * Distinct watchlist keys in the order the rows were supplied. Earlier rows rank higher — the
 * loader orders by first-watched time so a long-standing threat stays ahead of a just-added one.
 */
export function watchlistTeamKeys(rows: readonly WatchlistTeamRow[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = normalizeWatchlistTeamKey(row.teamKey);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** 0 = first on the watchlist. Unwatched teams sort after every watched team. */
export function watchlistPriority(
  teamKey: string | null | undefined,
  priorityTeamKeys: readonly string[],
): number {
  const key = normalizeWatchlistTeamKey(teamKey);
  if (!key || !priorityTeamKeys.length) return UNWATCHED;
  const index = priorityTeamKeys.findIndex((candidate) => normalizeWatchlistTeamKey(candidate) === key);
  return index < 0 ? UNWATCHED : index;
}

export function compareCoverageByWatchlist(
  a: CoverageOrderSlot,
  b: CoverageOrderSlot,
  priorityTeamKeys: readonly string[],
): number {
  return watchlistPriority(a.teamKey, priorityTeamKeys) - watchlistPriority(b.teamKey, priorityTeamKeys);
}

/**
 * Stable reorder: watched teams sort earlier, in watchlist order; everyone else keeps their
 * incoming relative order (schedule order from the coverage board).
 */
export function orderCoverageByWatchlist<T extends CoverageOrderSlot>(
  slots: readonly T[],
  priorityTeamKeys: readonly string[],
): T[] {
  const keys = watchlistTeamKeys(priorityTeamKeys.map((teamKey) => ({ teamKey })));
  if (!keys.length) return slots.slice();
  return slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => compareCoverageByWatchlist(a.slot, b.slot, keys) || a.index - b.index)
    .map((entry) => entry.slot);
}
