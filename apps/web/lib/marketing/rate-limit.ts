/**
 * Waitlist-facing rate limit helpers. Implementation lives in `lib/rate-limit`
 * so auth/invite/messages can share the same Upstash/memory fixed-window path.
 */
import {
  MemoryRateLimiter,
  RedisRateLimiter,
  anonymizeIp as hashIp,
  createRateLimiter as createSharedRateLimiter,
  type RateLimiter,
  type RateLimiterOptions,
} from "../rate-limit";

export { MemoryRateLimiter, RedisRateLimiter, type RateLimiter };

export function anonymizeIp(ip: string) {
  return hashIp(ip, "vantage-waitlist");
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  return createSharedRateLimiter({ limit: 5, windowMs: 60_000, namespace: "waitlist", ...options });
}
