import { describe, expect, it } from "vitest";
import { evaluateDataSourceHealth } from "./reference-health";

const now = new Date("2026-07-17T21:00:00.000Z");

describe("evaluateDataSourceHealth", () => {
  it("is ok when TBA health is healthy and cache exists", () => {
    const view = evaluateDataSourceHealth({
      now,
      cacheHasRows: true,
      orgId: "org-1",
      healthRows: [
        {
          source: "tba",
          status: "healthy",
          consecutiveFailures: 0,
          lastSuccessAt: "2026-07-17T20:55:00.000Z",
          lastFailureAt: null,
          lastError: null,
        },
      ],
      cursorRows: [
        {
          source: "tba",
          resourcesTracked: 12,
          resourcesWithEtag: 12,
          resourcesWithError: 0,
          lastSyncedAt: "2026-07-17T20:55:00.000Z",
          lastError: null,
          lastStatus: 304,
        },
      ],
    });
    expect(view.degraded).toBe(false);
    expect(view.mode).toBe("ok");
    expect(view.usingLastGoodCache).toBe(false);
    expect(view.sources[0]?.etagResources).toBe(12);
  });

  it("flags degraded and keeps last-good cache when TBA fails with ETag cursor errors", () => {
    const view = evaluateDataSourceHealth({
      now,
      cacheHasRows: true,
      orgId: "org-1",
      healthRows: [
        {
          source: "tba",
          status: "degraded",
          consecutiveFailures: 3,
          lastSuccessAt: "2026-07-17T18:00:00.000Z",
          lastFailureAt: "2026-07-17T20:50:00.000Z",
          lastError: "TBA 503 Service Unavailable",
        },
      ],
      cursorRows: [
        {
          source: "tba",
          resourcesTracked: 8,
          resourcesWithEtag: 7,
          resourcesWithError: 2,
          lastSyncedAt: "2026-07-17T18:00:00.000Z",
          lastError: "TBA 503 Service Unavailable",
          lastStatus: 503,
        },
      ],
    });
    expect(view.degraded).toBe(true);
    expect(view.mode).toBe("degraded");
    expect(view.usingLastGoodCache).toBe(true);
    expect(view.bannerTitle).toBe("Data source degraded");
    expect(view.bannerDetail).toMatch(/last-good Neon cache/i);
    expect(view.bannerDetail).toMatch(/503/);
  });

  it("marks unavailable without inventing cache when Neon is empty", () => {
    const view = evaluateDataSourceHealth({
      now,
      cacheHasRows: false,
      healthRows: [
        {
          source: "tba",
          status: "unavailable",
          consecutiveFailures: 5,
          lastSuccessAt: null,
          lastFailureAt: "2026-07-17T20:50:00.000Z",
          lastError: "network timeout",
        },
      ],
    });
    expect(view.mode).toBe("unavailable");
    expect(view.usingLastGoodCache).toBe(false);
    expect(view.bannerTitle).toBe("Data source unavailable");
  });

  it("marks stale when last success aged out but cache still usable", () => {
    const view = evaluateDataSourceHealth({
      now,
      cacheHasRows: true,
      healthRows: [
        {
          source: "tba",
          status: "healthy",
          consecutiveFailures: 0,
          lastSuccessAt: "2026-07-17T10:00:00.000Z",
          lastFailureAt: null,
          lastError: null,
        },
      ],
    });
    expect(view.mode).toBe("stale");
    expect(view.usingLastGoodCache).toBe(true);
  });

  it("does not invent an outage when health telemetry is missing", () => {
    const view = evaluateDataSourceHealth({
      now,
      cacheHasRows: true,
      healthRows: [],
      cursorRows: [],
    });
    expect(view.degraded).toBe(false);
    expect(view.mode).toBe("ok");
  });
});
