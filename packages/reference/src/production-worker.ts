import {
  listLiveFallbackOrgIds,
  NeonTbaCredentialStore,
  recordIngestSummary,
} from "./credential-store";
import { GlobalTbaCoordinator } from "./live-coordinator";
import { readPlatformTbaAuthKey } from "./platform-key";
import { globalReferenceAdminStore } from "./admin-store";
import { StatboticsClient } from "./statbotics-client";
import {
  createGlobalReferenceJobs,
  type GlobalReferenceWorkerOptions,
  type TbaGetter,
} from "./worker";
import type { EventDaySyncInput, SyncSummary } from "./types";

class CoordinatedTbaGetter implements TbaGetter {
  constructor(
    private readonly coordinator: GlobalTbaCoordinator,
    private readonly fallbackOrgIds: () => Promise<string[]>,
  ) {}

  async get<T>(
    resource: string,
    options: { etag?: string | null; lastModified?: string | null } = {},
  ) {
    return this.coordinator.get<T>(
      resource,
      options,
      await this.fallbackOrgIds(),
    );
  }
}

export function createProductionReferenceJobs(config: { preferOrgIds?: string[] } = {}) {
  const credentials = new NeonTbaCredentialStore();
  const coordinator = new GlobalTbaCoordinator(credentials, {
    baseUrl: process.env.TBA_API_BASE_URL,
  });
  const preferOrgIds = config.preferOrgIds ?? [];
  const tba: TbaGetter = new CoordinatedTbaGetter(coordinator, async () => {
    const fallback = await listLiveFallbackOrgIds();
    return [...new Set([...preferOrgIds, ...fallback])];
  });

  // Fail fast when neither env nor encrypted platform/org credentials can exist later.
  // Actual key resolution happens per-request inside the coordinator.
  if (!readPlatformTbaAuthKey()) {
    // Soft check: encrypted platform credential may still exist in Neon.
    // Defer hard failure to the first TBA call so sync routes can return a clear error.
  }

  const workerOptions: GlobalReferenceWorkerOptions = {
    store: globalReferenceAdminStore,
    tba,
    statbotics: new StatboticsClient({
      baseUrl: process.env.STATBOTICS_API_BASE_URL,
      userAgent: process.env.REFERENCE_INGEST_USER_AGENT,
      minimumIntervalMs: readPositiveInteger("STATBOTICS_MIN_INTERVAL_MS", 350),
      maximumAttempts: readPositiveInteger("STATBOTICS_MAX_ATTEMPTS", 4),
    }),
  };

  const jobs = createGlobalReferenceJobs(workerOptions);

  return {
    syncSeason: {
      id: jobs.syncSeason.id,
      async run(input: { year: number }): Promise<SyncSummary> {
        await assertTbaConfigured(credentials, preferOrgIds);
        const summary = await jobs.syncSeason.run(input);
        await recordIngestSummary({
          job: "reference.sync-season",
          ...summary,
          finishedAt: new Date().toISOString(),
        });
        return summary;
      },
    },
    syncEventDay: {
      id: jobs.syncEventDay.id,
      async run(input: EventDaySyncInput = {}): Promise<SyncSummary> {
        await assertTbaConfigured(credentials, preferOrgIds);
        const summary = await jobs.syncEventDay.run(input);
        await recordIngestSummary({
          job: "reference.sync-event-day",
          ...summary,
          finishedAt: new Date().toISOString(),
        });
        return summary;
      },
    },
  };
}

async function assertTbaConfigured(
  credentials: NeonTbaCredentialStore,
  preferOrgIds: string[] = [],
) {
  const platform = await credentials.platform();
  if (platform) return;
  const orgIds = [...new Set(preferOrgIds.filter(Boolean))];
  if (orgIds.length) {
    const fallbacks = await credentials.fallbackForOrgs(orgIds);
    if (fallbacks.length) return;
  }
  throw new Error(
    "TBA Read API key is not configured. Set TBA_AUTH_KEY (or TBA_API_KEY), save a platform credential in Admin → Live Data, or add a team fallback key.",
  );
}

function readPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
