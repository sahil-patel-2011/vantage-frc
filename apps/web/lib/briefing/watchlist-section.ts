// Opponent watchlist notes on the ONE pre-match briefing.
//
// /opponent-watchlist writes opponent_watchlist_entries (migration 0278). Members leave notes
// about robots they are tracking. The briefing only surfaces notes for opponents in THIS match
// that actually have text — an empty watchlist or notes about other teams do not invent threats.

import type { BriefingWatchNote } from "./types";

/** Row shape as read from opponent_watchlist_entries. */
export type WatchlistEntryRow = {
  teamKey: string;
  teamNumber: number | null;
  note: string | null;
  createdAt: string;
};

const MAX_WATCH_NOTES = 12;

/**
 * Watchlist notes for opponents in this match, newest-first.
 *
 * Callers should pass SQL rows already ordered by created_at DESC. Notes with no text, or for
 * teams not in the selected match, are dropped — never shown as TBA-derived "watch" items.
 */
export function selectBriefingWatchNotes(
  rows: WatchlistEntryRow[],
  opponentKeys: string[],
): BriefingWatchNote[] {
  const wanted = new Set(opponentKeys.filter((key) => key.length > 0));
  if (!wanted.size) return [];

  const notes: BriefingWatchNote[] = [];
  for (const row of rows) {
    const teamKey = typeof row.teamKey === "string" ? row.teamKey.trim() : "";
    const note = typeof row.note === "string" ? row.note.trim() : "";
    if (!teamKey || !wanted.has(teamKey) || !note) continue;
    const teamNumber = Number(row.teamNumber);
    notes.push({
      teamKey,
      teamNumber: Number.isFinite(teamNumber) && teamNumber > 0 ? teamNumber : null,
      note,
      createdAt: row.createdAt,
    });
    if (notes.length >= MAX_WATCH_NOTES) break;
  }
  return notes;
}
