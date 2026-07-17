import { afterEach, describe, expect, it } from "vitest";
import { MemoryRateLimiter, anonymizeIp, createRateLimiter } from "./rate-limit";

describe("MemoryRateLimiter", () => {
  afterEach(() => {
    // Isolate buckets between cases by using unique identifiers.
  });

  it("allows up to the limit inside a window", async () => {
    const limiter = new MemoryRateLimiter(2, 60_000);
    const id = `test-${Math.random()}`;
    expect(await limiter.allow(id)).toBe(true);
    expect(await limiter.allow(id)).toBe(true);
    expect(await limiter.allow(id)).toBe(false);
  });

  it("resets after the window elapses", async () => {
    const limiter = new MemoryRateLimiter(1, 5);
    const id = `reset-${Math.random()}`;
    expect(await limiter.allow(id)).toBe(true);
    expect(await limiter.allow(id)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await limiter.allow(id)).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("namespaces memory buckets so features do not share counters", async () => {
    const a = createRateLimiter({ limit: 1, namespace: `ns-a-${Math.random()}` });
    const b = createRateLimiter({ limit: 1, namespace: `ns-b-${Math.random()}` });
    const id = "same-user";
    expect(await a.allow(id)).toBe(true);
    expect(await b.allow(id)).toBe(true);
    expect(await a.allow(id)).toBe(false);
    expect(await b.allow(id)).toBe(false);
  });
});

describe("anonymizeIp", () => {
  it("returns a short stable hash without echoing the raw IP", () => {
    const hashed = anonymizeIp("203.0.113.9");
    expect(hashed).toHaveLength(20);
    expect(hashed).not.toContain("203");
    expect(anonymizeIp("203.0.113.9")).toBe(hashed);
  });
});
