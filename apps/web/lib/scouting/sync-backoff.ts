/**
 * Exponential backoff for scout outbox sync on flaky venue Wi-Fi.
 * Pure helpers — no IndexedDB / fetch. Mirror of messages pollBackoffMs.
 */

export const SYNC_BACKOFF_BASE_MS = 1000;
export const SYNC_BACKOFF_MAX_MS = 30000;
export const SYNC_MAX_ATTEMPTS = 5;

/** Delay before attempt `failures` (0-based after a failed try). Caps at SYNC_BACKOFF_MAX_MS. */
export function syncBackoffMs(failures: number): number {
  const exp = Math.max(0, Math.min(Math.floor(failures), 5));
  return Math.min(SYNC_BACKOFF_MAX_MS, SYNC_BACKOFF_BASE_MS * 2 ** exp);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Retry an async op with exponential backoff while online. */
export async function withSyncBackoff<T>(
  run: () => Promise<T>,
  options?: {
    maxAttempts?: number;
    signal?: AbortSignal;
    isOnline?: () => boolean;
    onRetry?: (failure: number, delayMs: number, error: unknown) => void;
  },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? SYNC_MAX_ATTEMPTS;
  const isOnline =
    options?.isOnline ??
    (() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (!isOnline()) throw lastError instanceof Error ? lastError : new Error("Offline — sync paused");
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      const next = attempt + 1;
      if (next >= maxAttempts || !isOnline()) break;
      const delay = syncBackoffMs(attempt);
      options?.onRetry?.(next, delay, error);
      await sleep(delay, options?.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Sync failed after retries");
}
