import { createHash } from "node:crypto";

export interface RateLimiter {
  allow(identifier: string): Promise<boolean>;
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export class MemoryRateLimiter implements RateLimiter {
  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
  ) {}

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
    private readonly namespace = "api",
  ) {}

  async allow(identifier: string) {
    const key = `vantage:${this.namespace}:${identifier}:${Math.floor(Date.now() / (this.windowSeconds * 1000))}`;
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

export function clientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function anonymizeIp(ip: string, salt = "vantage-rl") {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 20);
}

export type RateLimiterOptions = {
  limit?: number;
  windowMs?: number;
  /** Redis key namespace (and memory bucket prefix). */
  namespace?: string;
};

/** Fixed-window limiter; uses Upstash when RATE_LIMIT_REDIS_* is set, else in-memory. */
export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const limit = options.limit ?? 5;
  const windowMs = options.windowMs ?? 60_000;
  const namespace = options.namespace ?? "api";
  const url = process.env.RATE_LIMIT_REDIS_URL;
  const token = process.env.RATE_LIMIT_REDIS_TOKEN;
  if (url && token) {
    return new RedisRateLimiter(url, token, limit, Math.max(1, Math.ceil(windowMs / 1000)), namespace);
  }
  const memory = new MemoryRateLimiter(limit, windowMs);
  return {
    allow: (identifier: string) => memory.allow(`${namespace}:${identifier}`),
  };
}

export function rateLimitedResponse(message = "Please wait before trying again.") {
  return Response.json({ error: message }, { status: 429 });
}
