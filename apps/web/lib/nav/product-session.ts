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

export function invalidateProductSession() {
  cache = null;
}

export function fetchProductSession(orgId?: string | null): Promise<ProductSession | null> {
  const key = orgId?.trim() ?? "";
  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < TTL_MS) {
    return cache.data !== undefined ? Promise.resolve(cache.data) : cache.promise;
  }

  const promise = fetch(productSessionUrl(key), { cache: "no-store" })
    .then(async (response) => (response.ok ? ((await response.json()) as ProductSession) : null))
    .then((data) => {
      if (cache?.promise === promise) {
        cache.data = data;
        cache.at = Date.now();
      }
      return data;
    })
    .catch(() => {
      if (cache?.promise === promise) cache = null;
      return null;
    });

  cache = { key, promise, at: now };
  return promise;
}
