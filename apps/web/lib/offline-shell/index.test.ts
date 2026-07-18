import { describe, expect, it } from "vitest";
import {
  computeOfflineShellReadiness,
  OFFLINE_SHELL_TARGET_ROUTES,
  summarizeOfflineShell,
} from "./index";
import type { OfflineShellEvent } from "./types";

const baseEvent = (overrides: Partial<OfflineShellEvent>): OfflineShellEvent => ({
  id: "evt",
  deviceLabel: "Tablet A",
  routes: ["/scouting"],
  routeCount: 1,
  cacheBytes: 100,
  networkStatus: "online",
  notes: null,
  occurredAt: "2026-07-10T12:00:00.000Z",
  ...overrides,
});

describe("summarizeOfflineShell", () => {
  it("aggregates only recorded events — empty log stays empty", () => {
    const summary = summarizeOfflineShell([]);
    expect(summary.totalEvents).toBe(0);
    expect(summary.deviceCount).toBe(0);
    expect(summary.routesCovered).toEqual([]);
    expect(summary.lastSyncAt).toBeNull();
  });

  it("counts devices, routes, and offline-verified syncs from real rows", () => {
    const summary = summarizeOfflineShell([
      baseEvent({
        id: "1",
        deviceLabel: "A",
        routes: ["/offline", "/scouting"],
        routeCount: 2,
        networkStatus: "offline",
        occurredAt: "2026-07-10T12:00:00.000Z",
      }),
      baseEvent({
        id: "2",
        deviceLabel: "B",
        routes: ["/schedule"],
        routeCount: 1,
        networkStatus: "online",
        occurredAt: "2026-07-11T09:00:00.000Z",
        cacheBytes: 50,
      }),
    ]);
    expect(summary.totalEvents).toBe(2);
    expect(summary.deviceCount).toBe(2);
    expect(summary.offlineVerifiedCount).toBe(1);
    expect(summary.totalCacheBytes).toBe(150);
    expect(summary.routesCovered).toEqual(["/offline", "/schedule", "/scouting"]);
  });
});

describe("computeOfflineShellReadiness", () => {
  it("returns not_ready with no fabricated score when empty", () => {
    const readiness = computeOfflineShellReadiness(summarizeOfflineShell([]));
    expect(readiness.score).toBe(0);
    expect(readiness.tier).toBe("not_ready");
    expect(readiness.recommendations.length).toBeGreaterThan(0);
  });

  it("scores higher when target shell routes are covered", () => {
    const now = new Date("2026-07-11T10:00:00.000Z");
    const summary = summarizeOfflineShell([
      baseEvent({
        routes: [...OFFLINE_SHELL_TARGET_ROUTES],
        routeCount: OFFLINE_SHELL_TARGET_ROUTES.length,
        networkStatus: "offline",
        deviceLabel: "A",
        occurredAt: "2026-07-11T09:00:00.000Z",
      }),
      baseEvent({
        id: "2",
        deviceLabel: "B",
        routes: ["/scouting"],
        networkStatus: "offline",
        occurredAt: "2026-07-11T08:00:00.000Z",
      }),
      baseEvent({
        id: "3",
        deviceLabel: "C",
        routes: ["/schedule"],
        networkStatus: "offline",
        occurredAt: "2026-07-11T07:00:00.000Z",
      }),
    ]);
    const readiness = computeOfflineShellReadiness(summary, now);
    expect(readiness.components.routeCoverage).toBe(1);
    expect(readiness.score).toBeGreaterThan(0.5);
    expect(readiness.tier).not.toBe("not_ready");
  });
});
