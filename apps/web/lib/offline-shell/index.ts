// Offline-shell rollups + readiness scoring. Pure aggregation over logged cache events —
// deterministic given its input and an explicit "now" (no hidden clock reads inside the
// aggregation itself beyond what's passed in).

export * from "./types";

import type {
  OfflineShellEvent,
  OfflineShellNetworkStatus,
  OfflineShellReadiness,
  OfflineShellSummary,
  OfflineShellTier,
} from "./types";

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/** The shell routes offline precache is expected to cover for a cold, no-signal launch. */
export const OFFLINE_SHELL_TARGET_ROUTES: string[] = [
  "/offline",
  "/scouting",
  "/schedule",
  "/offline-shell",
];

export const OFFLINE_SHELL_NETWORK_STATUSES: OfflineShellNetworkStatus[] = ["online", "offline", "degraded"];

export function offlineShellNetworkStatusLabel(status: OfflineShellNetworkStatus): string {
  const labels: Record<OfflineShellNetworkStatus, string> = {
    online: "Online",
    offline: "Offline (no signal)",
    degraded: "Degraded",
  };
  return labels[status];
}

export type OfflineShellTargets = {
  /** Distinct devices with a recent sync that reads as broad team coverage (default 3). */
  deviceTarget: number;
  /** Hours since last sync that still reads as "fresh" (default 72h). */
  recencyHours: number;
};

export const DEFAULT_OFFLINE_SHELL_TARGETS: OfflineShellTargets = {
  deviceTarget: 3,
  recencyHours: 72,
};

/**
 * Aggregate offline-shell cache events into totals + per-device breakdown.
 */
export function summarizeOfflineShell(events: OfflineShellEvent[]): OfflineShellSummary {
  const deviceMap = new Map<
    string,
    { events: number; lastSyncAt: string; lastNetworkStatus: OfflineShellNetworkStatus; routeCount: number }
  >();
  const routeSet = new Set<string>();
  let totalCacheBytes = 0;
  let offlineVerifiedCount = 0;
  let lastSyncAt: string | null = null;

  for (const event of events) {
    totalCacheBytes += Math.max(0, event.cacheBytes || 0);
    if (event.networkStatus === "offline") offlineVerifiedCount += 1;
    for (const route of event.routes) routeSet.add(route);
    if (!lastSyncAt || event.occurredAt > lastSyncAt) lastSyncAt = event.occurredAt;

    const existing = deviceMap.get(event.deviceLabel);
    if (!existing || event.occurredAt > existing.lastSyncAt) {
      deviceMap.set(event.deviceLabel, {
        events: (existing?.events ?? 0) + 1,
        lastSyncAt: event.occurredAt,
        lastNetworkStatus: event.networkStatus,
        routeCount: event.routeCount,
      });
    } else {
      existing.events += 1;
    }
  }

  const byDevice = [...deviceMap.entries()]
    .map(([deviceLabel, value]) => ({ deviceLabel, ...value }))
    .sort((a, b) => b.lastSyncAt.localeCompare(a.lastSyncAt));

  return {
    totalEvents: events.length,
    deviceCount: deviceMap.size,
    routesCovered: [...routeSet].sort(),
    totalCacheBytes,
    lastSyncAt,
    offlineVerifiedCount,
    byDevice,
  };
}

function tierFor(score: number): OfflineShellTier {
  if (score >= 0.66) return "ready";
  if (score >= 0.33) return "partial";
  return "not_ready";
}

/**
 * Score offline-shell readiness from only what's been recorded. An empty log yields 0
 * across the board — no fabricated confidence.
 */
export function computeOfflineShellReadiness(
  summary: OfflineShellSummary,
  now: Date = new Date(),
  targets: Partial<OfflineShellTargets> = {},
): OfflineShellReadiness {
  const t = { ...DEFAULT_OFFLINE_SHELL_TARGETS, ...targets };

  if (summary.totalEvents === 0) {
    return {
      score: 0,
      tier: "not_ready",
      components: { routeCoverage: 0, deviceCoverage: 0, recency: 0, offlineVerified: 0 },
      recommendations: [
        "Precache the shell on at least one device and record a sync — this is the evidence trail for offline readiness.",
      ],
    };
  }

  const routeCoverage = clamp01(
    OFFLINE_SHELL_TARGET_ROUTES.filter((route) => summary.routesCovered.includes(route)).length /
      OFFLINE_SHELL_TARGET_ROUTES.length,
  );
  const deviceCoverage = clamp01(summary.deviceCount / t.deviceTarget);
  const hoursSinceSync = summary.lastSyncAt
    ? (now.getTime() - new Date(summary.lastSyncAt).getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;
  const recency = clamp01(1 - hoursSinceSync / t.recencyHours);
  const offlineVerified = clamp01(summary.offlineVerifiedCount / Math.max(1, summary.deviceCount));

  const components = {
    routeCoverage: round(routeCoverage),
    deviceCoverage: round(deviceCoverage),
    recency: round(recency),
    offlineVerified: round(offlineVerified),
  };

  const score = round(
    0.35 * routeCoverage + 0.25 * deviceCoverage + 0.2 * recency + 0.2 * offlineVerified,
  );

  const recommendations: string[] = [];
  if (components.routeCoverage < 1) {
    const missing = OFFLINE_SHELL_TARGET_ROUTES.filter((route) => !summary.routesCovered.includes(route));
    recommendations.push(`Precache missing shell route(s): ${missing.join(", ")}.`);
  }
  if (components.deviceCoverage < 0.5) {
    recommendations.push(
      `Sync more scouting devices — ${summary.deviceCount} of ${t.deviceTarget} target device(s) reporting.`,
    );
  }
  if (components.recency < 0.5) {
    recommendations.push("Re-sync soon — the last recorded cache build is getting stale.");
  }
  if (components.offlineVerified < 0.5) {
    recommendations.push("Verify a cold launch with radios off, then log it as an offline-network sync.");
  }
  if (recommendations.length === 0) {
    recommendations.push("Shell is precached and recently verified offline — keep syncing after each deploy.");
  }

  return { score, tier: tierFor(score), components, recommendations };
}
