// Offline Shell domain types. Pure data shapes — no I/O, no framework imports.
// Tracks service-worker precache builds/syncs so the scouting/schedule app shell can
// cold-launch with no signal. Distinct from live scouting-submission sync queues — this
// is CACHE READINESS of the shell itself, not application data.

export type OfflineShellNetworkStatus = "online" | "offline" | "degraded";

export type OfflineShellEvent = {
  id: string;
  deviceLabel: string;
  routes: string[];
  routeCount: number;
  cacheBytes: number;
  networkStatus: OfflineShellNetworkStatus;
  notes: string | null;
  occurredAt: string;
};

export type OfflineShellSummary = {
  totalEvents: number;
  deviceCount: number;
  routesCovered: string[];
  totalCacheBytes: number;
  lastSyncAt: string | null;
  offlineVerifiedCount: number;
  byDevice: Array<{
    deviceLabel: string;
    events: number;
    lastSyncAt: string;
    lastNetworkStatus: OfflineShellNetworkStatus;
    routeCount: number;
  }>;
};

export type OfflineShellTier = "not_ready" | "partial" | "ready";

export type OfflineShellReadiness = {
  /** 0..1 overall offline-shell readiness. */
  score: number;
  tier: OfflineShellTier;
  components: {
    routeCoverage: number;
    deviceCoverage: number;
    recency: number;
    offlineVerified: number;
  };
  recommendations: string[];
};
