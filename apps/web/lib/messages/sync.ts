/** Pure helpers for team-message incremental sync (no DB). */

export type SyncMessage = {
  id: string;
  createdAt: string;
  updatedAt?: string | null;
  deletedAt?: string | null;
  pinnedAt?: string | null;
};

export const LONG_POLL_MAX_MS = 7500;
export const LONG_POLL_TICK_MS = 1200;
export const POLL_BACKOFF_BASE_MS = 2000;
export const POLL_BACKOFF_MAX_MS = 30000;

export function clampWaitMs(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(LONG_POLL_MAX_MS, Math.floor(n));
}

export function pollBackoffMs(failures: number): number {
  const exp = Math.max(0, Math.min(failures, 4));
  return Math.min(POLL_BACKOFF_MAX_MS, POLL_BACKOFF_BASE_MS * 2 ** exp);
}

export function nextWatermark(messages: SyncMessage[], previous: string | null): string | null {
  let max = previous;
  for (const message of messages) {
    for (const candidate of [message.updatedAt, message.createdAt, message.deletedAt, message.pinnedAt]) {
      if (!candidate) continue;
      if (!max || candidate > max) max = candidate;
    }
  }
  return max;
}

export function mergeMessages<T extends SyncMessage>(previous: T[], incoming: T[]): T[] {
  if (!incoming.length) return previous;
  const map = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function totalUnread(conversations: Array<{ unreadCount: number }>): number {
  return conversations.reduce((sum, item) => sum + Math.max(0, Number(item.unreadCount) || 0), 0);
}
