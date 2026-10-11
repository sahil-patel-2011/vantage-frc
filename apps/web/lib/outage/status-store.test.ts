import { describe, expect, it, vi } from "vitest";
import { readRecipientEmails, readRecipientMeta, saveRecipientSnapshot, normalizeRecipients, snapshotIsStale } from "./recipients";
import {
  FallbackOutageStore,
  MemoryOutageStore,
  OutageSecretMissingError,
  UpstashOutageStore,
  openValue,
  outageSecret,
  outageStoreConfig,
  sealValue,
} from "./status-store";

const SECRET = "a-better-auth-secret-for-tests";

describe("sealing values for the outage store", () => {
  it("round-trips, and the stored form never contains the plaintext", () => {
    const plaintext = JSON.stringify(["coach@example.com", "student@example.org"]);
    const sealed = sealValue(plaintext, "service-notice-recipients", SECRET);
    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain("example.com");
    expect(openValue(sealed, "service-notice-recipients", SECRET)).toBe(plaintext);
    // A fresh IV each time.
    expect(sealValue(plaintext, "service-notice-recipients", SECRET)).not.toBe(sealed);
  });

  it("refuses the wrong secret, the wrong label, or a changed byte", () => {
    const sealed = sealValue("hello", "label-a", SECRET);
    expect(() => openValue(sealed, "label-a", "another-secret")).toThrow();
    expect(() => openValue(sealed, "label-b", SECRET)).toThrow();
    const raw = Buffer.from(sealed.slice(3), "base64url");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => openValue(`v1.${raw.toString("base64url")}`, "label-a", SECRET)).toThrow();
    expect(() => openValue("v2.abc", "label-a", SECRET)).toThrow();
  });

  it("needs BETTER_AUTH_SECRET in production", () => {
    expect(() => outageSecret({ NODE_ENV: "production" })).toThrow(OutageSecretMissingError);
    expect(outageSecret({ NODE_ENV: "production", BETTER_AUTH_SECRET: " s3cret " })).toBe("s3cret");
    expect(outageSecret({ NODE_ENV: "test" })).toBeTruthy();
  });
});

describe("recipient snapshot", () => {
  it("normalizes, seals and reads back the list; the store only sees ciphertext", async () => {
    const store = new MemoryOutageStore();
    const meta = await saveRecipientSnapshot(
      store,
      [" Coach@Example.com ", "coach@example.com", "not-an-email", null, "student@example.org"],
      Date.parse("2026-10-11T00:00:00Z"),
      SECRET,
    );
    expect(meta).toEqual({ count: 2, refreshedAt: "2026-10-11T00:00:00.000Z" });
    const raw = await store.get("recipients");
    expect(raw).not.toMatch(/example\.(com|org)/);
    expect(await readRecipientMeta(store)).toEqual(meta);
    expect(await readRecipientEmails(store, SECRET)).toEqual(["coach@example.com", "student@example.org"]);
    // Sealed with another deployment's secret: unreadable, not an error.
    expect(await readRecipientEmails(store, "other-secret")).toBeNull();
  });

  it("is stale when missing or older than 12 hours", () => {
    const now = Date.parse("2026-10-11T12:00:00Z");
    expect(snapshotIsStale(null, now)).toBe(true);
    expect(snapshotIsStale({ count: 1, refreshedAt: "2026-10-11T01:00:00Z" }, now)).toBe(false);
    expect(snapshotIsStale({ count: 1, refreshedAt: "2026-10-10T23:59:00Z" }, now)).toBe(true);
    expect(normalizeRecipients(["b@x.io", "a@x.io", "B@x.io"])).toEqual(["a@x.io", "b@x.io"]);
  });
});

describe("outage stores", () => {
  it("memory store: set-if-absent works as a lock and keys expire", async () => {
    let now = 0;
    const store = new MemoryOutageStore(() => now);
    expect(await store.set("lock", "a", { onlyIfAbsent: true, ttlSeconds: 10 })).toBe(true);
    expect(await store.set("lock", "b", { onlyIfAbsent: true })).toBe(false);
    expect(await store.get("lock")).toBe("a");
    now = 11_000;
    expect(await store.get("lock")).toBeNull();
    expect(await store.set("lock", "c", { onlyIfAbsent: true })).toBe(true);
  });

  it("Upstash store sends prefixed REST commands with EX and NX", async () => {
    const calls: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as string[];
      calls.push(command);
      const result = command[0] === "SET" ? (command.includes("NX") ? null : "OK") : command[0] === "GET" ? "value" : 1;
      return new Response(JSON.stringify({ result }), { status: 200 });
    });
    const store = new UpstashOutageStore("https://kv.example.test/", "token-1", fetchImpl as unknown as typeof fetch);
    expect(await store.get("incident")).toBe("value");
    expect(await store.set("incident", "{}", { ttlSeconds: 60 })).toBe(true);
    expect(await store.set("lock:x", "1", { onlyIfAbsent: true, ttlSeconds: 5 })).toBe(false);
    await store.delete("notice");
    expect(calls).toEqual([
      ["GET", "vantage:outage:incident"],
      ["SET", "vantage:outage:incident", "{}", "EX", "60"],
      ["SET", "vantage:outage:lock:x", "1", "EX", "5", "NX"],
      ["DEL", "vantage:outage:notice"],
    ]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://kv.example.test");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer token-1");
  });

  it("falls back to memory when the shared store fails", async () => {
    const failing = new UpstashOutageStore("https://kv.example.test", "t", (async () => new Response("no", { status: 500 })) as unknown as typeof fetch);
    const log = vi.fn();
    const store = new FallbackOutageStore(failing, new MemoryOutageStore(), log);
    expect(await store.set("a", "1")).toBe(true);
    expect(await store.get("a")).toBe("1");
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("prefers OUTAGE_REDIS_* and falls back to the rate limiter's Redis", () => {
    expect(outageStoreConfig({})).toBeNull();
    expect(outageStoreConfig({ RATE_LIMIT_REDIS_URL: "https://r", RATE_LIMIT_REDIS_TOKEN: "t" })).toMatchObject({ source: "RATE_LIMIT_REDIS" });
    expect(
      outageStoreConfig({ OUTAGE_REDIS_URL: "https://o", OUTAGE_REDIS_TOKEN: "o", RATE_LIMIT_REDIS_URL: "https://r", RATE_LIMIT_REDIS_TOKEN: "t" }),
    ).toMatchObject({ url: "https://o", source: "OUTAGE_REDIS" });
  });
});
