/** Pure helpers for chat history pagination (no DB).
 *
 * Initial thread loads fetch the NEWEST page (created_at DESC, id DESC) and
 * reverse it for display; "Show earlier messages" pages backward with a keyset
 * cursor at the oldest loaded message. Incremental `since` polling is separate
 * (see ./sync.ts) and unaffected by these helpers.
 */

export type HistoryMessage = {
  id: string;
  createdAt: string;
};

export const HISTORY_PAGE_SIZE = 100;

export type HistoryCursor = { before: string; beforeId: string };

/**
 * Rows arrive newest-first (created_at DESC, id DESC), fetched with pageSize+1
 * so the extra row signals that older history exists. Returns the display page
 * oldest-first.
 */
export function trimHistoryPage<T extends HistoryMessage>(
  rows: T[],
  pageSize: number = HISTORY_PAGE_SIZE,
): { messages: T[]; hasEarlier: boolean } {
  const hasEarlier = rows.length > pageSize;
  const page = hasEarlier ? rows.slice(0, pageSize) : rows.slice();
  page.reverse();
  return { messages: page, hasEarlier };
}

function compareHistory(a: HistoryMessage, b: HistoryMessage): number {
  const byTime = a.createdAt.localeCompare(b.createdAt);
  return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
}

/** Keyset cursor for the "Show earlier messages" request: the oldest loaded message. */
export function earliestCursor(messages: HistoryMessage[]): HistoryCursor | null {
  let oldest: HistoryMessage | null = null;
  for (const message of messages) {
    if (!oldest || compareHistory(message, oldest) < 0) oldest = message;
  }
  return oldest ? { before: oldest.createdAt, beforeId: oldest.id } : null;
}

/**
 * Prepend an older page onto already-loaded messages. Entries already loaded
 * win over older copies of the same id (they may carry fresher edit/pin/delete
 * state). Result is ascending by (createdAt, id).
 */
export function prependEarlier<T extends HistoryMessage>(existing: T[], earlier: T[]): T[] {
  if (!earlier.length) return existing;
  const byId = new Map<string, T>();
  for (const item of earlier) byId.set(item.id, item);
  for (const item of existing) byId.set(item.id, item);
  return [...byId.values()].sort(compareHistory);
}
