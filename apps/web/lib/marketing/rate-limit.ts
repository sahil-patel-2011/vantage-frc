import { createHash } from "node:crypto";

export interface RateLimiter {
  allow(identifier: string): Promise<boolean>;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export class MemoryRateLimiter implements RateLimiter {
  constructor(private readonly limit = 5, private readonly windowMs = 60_000) {}

  async allow(identifier: string) {
    const now = Date.now();
    const bucket = buckets.get(identifier);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(identifier, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }
}

/** Upstash-compatible REST limiter with one fixed-window atomic command. */
export class RedisRateLimiter implements RateLimiter {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly limit = 5,
    private readonly windowSeconds = 60,
  ) {}

  async allow(identifier: string) {
    const key = `vantage:waitlist:${identifier}:${Math.floor(Date.now() / (this.windowSeconds * 1000))}`;
    const response = await fetch(`${this.url}/pipeline`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, String(this.windowSeconds), "NX"],
      ]),
    });
    if (!response.ok) throw new Error("Rate limiter unavailable");
    const values = (await response.json()) as Array<{ result: number }>;
    return Number(values[0]?.result ?? this.limit + 1) <= this.limit;
  }
}

export function anonymizeIp(ip: string) {
  return createHash("sha256").update(`vantage-waitlist:${ip}`).digest("hex").slice(0, 20);
}

export function createRateLimiter(): RateLimiter {
  const url = process.env.RATE_LIMIT_REDIS_URL;
  const token = process.env.RATE_LIMIT_REDIS_TOKEN;
  return url && token ? new RedisRateLimiter(url, token) : new MemoryRateLimiter();
}
