// Upstream chat timeout policy — pure config helpers, no I/O.
//
// The invariant that matters on serverless: the ADAPTER's fetch timeout must be
// SHORTER than the route's `export const maxDuration`, otherwise the platform
// kills the function mid-request and the caller sees a hang / opaque 502
// instead of a clean, classified timeout error. Routes that call a chat
// adapter declare `maxDuration = 60` (300 for cron), so the default here stays
// at 50s with headroom for auth + DB work around the upstream call.

/** Default upstream fetch timeout: under the 60s route budget AI routes declare. */
export const DEFAULT_CHAT_FETCH_TIMEOUT_MS = 50_000;

/** Floor — anything lower aborts before a model can answer at all. */
export const MIN_CHAT_FETCH_TIMEOUT_MS = 1_000;

/** Ceiling — stays under the 300s maxDuration that long-running cron routes declare. */
export const MAX_CHAT_FETCH_TIMEOUT_MS = 290_000;

/**
 * Resolve the upstream chat timeout from an explicit config value or the
 * `VANTAGE_CHAT_TIMEOUT_MS` env var. Non-numeric, non-finite, zero, or negative
 * input falls back to the default; valid values are clamped into
 * [MIN, MAX] so a typo can never produce an instant abort or an
 * outlives-the-function timeout.
 */
export function resolveChatFetchTimeoutMs(raw?: string | number | null): number {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_CHAT_FETCH_TIMEOUT_MS;
  const parsed = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CHAT_FETCH_TIMEOUT_MS;
  return Math.min(MAX_CHAT_FETCH_TIMEOUT_MS, Math.max(MIN_CHAT_FETCH_TIMEOUT_MS, Math.round(parsed)));
}

/**
 * Typed upstream-timeout error so route fail-mappers can classify the abort
 * (504) instead of reporting a generic 400. Never wraps provider payloads —
 * the message carries only the timeout budget.
 */
export class ChatUpstreamTimeoutError extends Error {
  readonly status = 504;
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Upstream chat request timed out after ${timeoutMs}ms — the provider did not answer in time. Try again.`);
    this.name = "ChatUpstreamTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Duck-typed check (survives duplicated module instances across bundles). */
export function isChatUpstreamTimeout(error: unknown): boolean {
  return (
    error instanceof ChatUpstreamTimeoutError ||
    (error instanceof Error && error.name === "ChatUpstreamTimeoutError")
  );
}
