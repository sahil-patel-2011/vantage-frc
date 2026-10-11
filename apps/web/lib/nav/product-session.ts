import { forgetMe, requestMe, sessionOrgId } from "./me-request";

/** One in-flight /api/me read shared by AppShell, Home, and other product pages. */

export type ProductSession = {
  authenticated?: boolean;
  userId?: string;
  name?: string | null;
  firstName?: string | null;
  displayName?: string | null;
  email?: string | null;
  image?: string | null;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  teamRole?: string | null;
  tbaConfigured?: boolean;
  /** Runs Vantage itself (a platform_admins row), whether or not they are on a team. */
  platformAdmin?: boolean;
  memberships?: Array<{
    orgId: string;
    orgName?: string | null;
    teamNumber?: number | null;
    role?: string | null;
  }>;
  unreadNotificationCount?: number;
  unreadMessageCount?: number;
  [key: string]: unknown;
};

type CacheEntry = {
  key: string;
  promise: Promise<ProductSession | null>;
  data?: ProductSession | null;
  at: number;
};

const TTL_MS = 8_000;
let cache: CacheEntry | null = null;

export function productSessionUrl(orgId?: string | null): string {
  const id = orgId?.trim() ?? "";
  return id ? `/api/me?orgId=${encodeURIComponent(id)}` : "/api/me";
}

/** Drops the cached answer and any offline wait: Retry, sign-out and team switches ask again. */
export function invalidateProductSession() {
  cache = null;
  forgetMe();
}

/**
 * Whether the last session read failed to reach an answer (offline, timed out, or a server
 * error), as opposed to answering "not signed in" (401). Home must not read the first as
 * "this person has no team".
 */
let lastSessionUnreachable = false;
export function productSessionUnreachable(): boolean {
  return lastSessionUnreachable;
}

export function fetchProductSession(orgId?: string | null): Promise<ProductSession | null> {
  const key = sessionOrgId(orgId);
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < TTL_MS) {
    return cache.data !== undefined ? Promise.resolve(cache.data) : cache.promise;
  }

  // The same request `requestMe` callers share: the shell and the hooks that read /api/me on
  // one page used to make two identical calls, and it carries the offline backoff.
  const promise = requestMe(key || null)
    .then((result) => {
      const unreachable = result.status === 0 || result.status >= 500;
      lastSessionUnreachable = unreachable;
      const data = result.ok ? (result.data as ProductSession | null) : null;
      if (cache?.promise === promise) {
        // An unanswered read is not kept: the next one asks requestMe, which spaces retries out
        // and lets the first read after reconnecting through.
        if (unreachable) cache = null;
        else {
          cache.data = data;
          cache.at = Date.now();
        }
      }
      return data;
    })
    .catch(() => {
      lastSessionUnreachable = true;
      if (cache?.promise === promise) cache = null;
      return null;
    });

  cache = { key, promise, at: now };
  return promise;
}
