import { describe, expect, it } from "vitest";
import {
  freeRelayStatsUrl,
  hashFreeRelayDeviceKey,
  PLATFORM_FREEBUFF_RELAY_NAME,
  probeFreeRelayStats,
  shapeLiveRelayStats,
} from "./free-relay-devices";

describe("free relay device helpers", () => {
  it("names the platform Freebuff Pi", () => {
    expect(PLATFORM_FREEBUFF_RELAY_NAME).toBe("frcvantagefreebuff relay");
  });

  it("hashes a key without storing the plaintext", () => {
    const hash = hashFreeRelayDeviceKey("vr_secret");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("vr_secret");
    expect(hashFreeRelayDeviceKey("vr_secret")).toBe(hash);
  });

  it("points stats at /v1/stats for either a /v1 base or a host root", () => {
    expect(freeRelayStatsUrl("https://relay.example.com/v1")).toBe("https://relay.example.com/v1/stats");
    expect(freeRelayStatsUrl("https://relay.example.com/v1/")).toBe("https://relay.example.com/v1/stats");
  });

  it("shapes a real stats payload and does not invent tok/s", () => {
    expect(shapeLiveRelayStats(null)).toBeNull();
    expect(
      shapeLiveRelayStats({
        ok: true,
        model: "glm/glm-5.3-flash",
        bind: "127.0.0.1:8080",
        upstreamOk: true,
        isolation: "request-scoped",
        concurrency: { active: 2, max: 16, available: 14, byFeature: { chat: 1, cad: 1 } },
        tokens: { day: "2026-09-02", in: 400, out: 80, outPerSec: 1.2 },
      }),
    ).toMatchObject({
      ok: true,
      tokensIn: 400,
      tokensOut: 80,
      tokensOutPerSec: 1.2,
      activeRequests: 2,
      byFeature: { chat: 1, cad: 1 },
    });
  });

  it("reports a probe error instead of fabricating zeros as live", async () => {
    const result = await probeFreeRelayStats({
      baseUrl: "https://relay.example.com/v1",
      apiKey: "vr_test",
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/fetch failed/);
    expect(result.tokensOut).toBe(0);
  });
});
