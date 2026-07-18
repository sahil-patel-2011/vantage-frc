import type { PoolClient } from "@neondatabase/serverless";

export type ReferenceSourceHealth = {
  source: string;
  status: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  cacheSyncedAt: string | null;
  etagResources: number;
  erroredResources: number;
  lastHttpStatus: number | null;
};

export type DataSourceHealthView = {
  degraded: boolean;
  mode: "ok" | "degraded" | "unavailable" | "stale";
  usingLastGoodCache: boolean;
  cacheHasRows: boolean;
  sources: ReferenceSourceHealth[];
  bannerTitle: string;
  bannerDetail: string;
  teamDataHref: string;
};

type HealthRow = {
  source: string;
  status: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
};

type CursorRow = {
  source: string;
  resourcesTracked: number;
  resourcesWithEtag: number;
  resourcesWithError: number;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastStatus: number | null;
};

type FreshnessRow = {
  syncedAt: string | null;
  healthStatus: string | null;
  lastError: string | null;
  lastSuccessAt: string | null;
  etagResources: number | null;
  erroredResources: number | null;
  lastHttpStatus: number | null;
};

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function isUnhealthyStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === "degraded" || normalized === "unavailable" || normalized === "failed";
}

function pickMode(input: {
  unhealthy: boolean;
  unavailable: boolean;
  stale: boolean;
  cacheHasRows: boolean;
}): DataSourceHealthView["mode"] {
  if (input.unavailable) return "unavailable";
  if (input.unhealthy) return "degraded";
  if (input.stale && input.cacheHasRows) return "stale";
  return "ok";
}

function bannerCopy(
  mode: DataSourceHealthView["mode"],
  cacheHasRows: boolean,
  sources: ReferenceSourceHealth[],
): { bannerTitle: string; bannerDetail: string } {
  const names = sources.map((s) => s.source.toUpperCase()).join(" / ") || "TBA";
  const lastError = sources.map((s) => s.lastError).find(Boolean) ?? null;
  const lastSuccess = sources
    .map((s) => s.lastSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const successLabel = lastSuccess ? new Date(lastSuccess).toLocaleString() : "unknown";

  if (mode === "ok") {
    return {
      bannerTitle: "Reference data sources healthy",
      bannerDetail: `${names} ingest is healthy. Strategy uses the Neon reference cache.`,
    };
  }

  if (mode === "unavailable" && !cacheHasRows) {
    return {
      bannerTitle: "Data source unavailable",
      bannerDetail: lastError
        ? `${names} is down (${lastError}). No last-good Neon cache yet — sync under Team → Data when the API recovers.`
        : `${names} is down and no last-good Neon cache is available yet.`,
    };
  }

  if (mode === "stale") {
    return {
      bannerTitle: "Data source may be stale",
      bannerDetail: `No recent successful ${names} sync (last success ${successLabel}). Strategy is using the last-good Neon cache — not live TBA.`,
    };
  }

  return {
    bannerTitle: "Data source degraded",
    bannerDetail: lastError
      ? `${names} ingest is degraded (${lastError}). Strategy keeps working from the last-good Neon cache (synced ${successLabel}).`
      : `${names} ingest is degraded. Strategy keeps working from the last-good Neon cache (last success ${successLabel}).`,
  };
}

/** Pure evaluator for TBA/Statbotics health + ETag cursor signals. */
export function evaluateDataSourceHealth(input: {
  healthRows: HealthRow[];
  cursorRows?: CursorRow[];
  freshness?: FreshnessRow | null;
  cacheHasRows: boolean;
  orgId?: string | null;
  now?: Date;
}): DataSourceHealthView {
  const now = input.now ?? new Date();
  const cursorBySource = new Map((input.cursorRows ?? []).map((row) => [row.source, row]));
  const healthBySource = new Map(input.healthRows.map((row) => [row.source, row]));

  const sourceKeys = new Set<string>([
    ...healthBySource.keys(),
    ...cursorBySource.keys(),
    ...(input.freshness ? ["tba"] : []),
  ]);
  if (sourceKeys.size === 0) sourceKeys.add("tba");

  const sources: ReferenceSourceHealth[] = [...sourceKeys].sort().map((source) => {
    const health = healthBySource.get(source);
    const cursor = cursorBySource.get(source);
    const freshness = source === "tba" ? input.freshness : null;
    return {
      source,
      status: health?.status ?? freshness?.healthStatus ?? "unknown",
      consecutiveFailures: health?.consecutiveFailures ?? 0,
      lastSuccessAt: health?.lastSuccessAt ?? freshness?.lastSuccessAt ?? null,
      lastFailureAt: health?.lastFailureAt ?? null,
      lastError: health?.lastError ?? freshness?.lastError ?? cursor?.lastError ?? null,
      cacheSyncedAt: freshness?.syncedAt ?? cursor?.lastSyncedAt ?? null,
      etagResources: freshness?.etagResources ?? cursor?.resourcesWithEtag ?? 0,
      erroredResources: freshness?.erroredResources ?? cursor?.resourcesWithError ?? 0,
      lastHttpStatus: freshness?.lastHttpStatus ?? cursor?.lastStatus ?? null,
    };
  });

  const unhealthy = sources.some(
    (source) =>
      isUnhealthyStatus(source.status) ||
      source.consecutiveFailures > 0 ||
      Boolean(source.lastError) ||
      source.erroredResources > 0,
  );
  const unavailable = sources.some((source) => source.status.trim().toLowerCase() === "unavailable");
  const newestSuccess = sources
    .map((source) => (source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : NaN))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];
  const stale =
    !unhealthy &&
    input.cacheHasRows &&
    newestSuccess != null &&
    now.getTime() - newestSuccess > STALE_AFTER_MS;

  const mode = pickMode({
    unhealthy,
    unavailable,
    stale,
    cacheHasRows: input.cacheHasRows,
  });
  const degraded = mode !== "ok";
  const copy = bannerCopy(mode, input.cacheHasRows, sources);

  return {
    degraded,
    mode,
    usingLastGoodCache: degraded && input.cacheHasRows,
    cacheHasRows: input.cacheHasRows,
    sources,
    bannerTitle: copy.bannerTitle,
    bannerDetail: copy.bannerDetail,
    teamDataHref: input.orgId ? `/team/data?orgId=${encodeURIComponent(input.orgId)}` : "/team/data",
  };
}

export async function loadDataSourceHealth(
  client: PoolClient,
  orgId?: string | null,
): Promise<DataSourceHealthView> {
  let cacheHasRows = false;
  try {
    const cache = await client.query<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM matches_ref LIMIT 1)
              OR EXISTS(SELECT 1 FROM team_event_metrics LIMIT 1)
              OR EXISTS(SELECT 1 FROM events_ref LIMIT 1) AS ok`,
    );
    cacheHasRows = Boolean(cache.rows[0]?.ok);
  } catch {
    cacheHasRows = false;
  }

  let healthRows: HealthRow[] = [];
  try {
    const health = await client.query<{
      source: string;
      status: string;
      consecutiveFailures: number;
      lastSuccessAt: string | null;
      lastFailureAt: string | null;
      details: Record<string, unknown> | null;
    }>(
      `SELECT source, status,
              consecutive_failures AS "consecutiveFailures",
              last_success_at::text AS "lastSuccessAt",
              last_failure_at::text AS "lastFailureAt",
              details
       FROM data_source_health
       WHERE source IN ('tba', 'statbotics')
       ORDER BY source`,
    );
    healthRows = health.rows.map((row) => ({
      source: row.source,
      status: row.status,
      consecutiveFailures: Number(row.consecutiveFailures ?? 0),
      lastSuccessAt: row.lastSuccessAt,
      lastFailureAt: row.lastFailureAt,
      lastError: row.details && typeof row.details.error === "string" ? row.details.error : null,
    }));
  } catch {
    healthRows = [];
  }

  let cursorRows: CursorRow[] = [];
  try {
    const cursors = await client.query<{
      source: string;
      resourcesTracked: number;
      resourcesWithEtag: number;
      resourcesWithError: number;
      lastSyncedAt: string | null;
      lastError: string | null;
      lastStatus: number | null;
    }>(
      `SELECT source,
              resources_tracked AS "resourcesTracked",
              resources_with_etag AS "resourcesWithEtag",
              resources_with_error AS "resourcesWithError",
              last_synced_at::text AS "lastSyncedAt",
              last_error AS "lastError",
              last_status AS "lastStatus"
       FROM app_reference_cursor_summary()`,
    );
    cursorRows = cursors.rows.map((row) => ({
      ...row,
      resourcesTracked: Number(row.resourcesTracked ?? 0),
      resourcesWithEtag: Number(row.resourcesWithEtag ?? 0),
      resourcesWithError: Number(row.resourcesWithError ?? 0),
      lastStatus: row.lastStatus == null ? null : Number(row.lastStatus),
    }));
  } catch {
    cursorRows = [];
  }

  let freshness: FreshnessRow | null = null;
  try {
    const row = await client.query<{
      syncedAt: string | null;
      healthStatus: string | null;
      lastError: string | null;
      lastSuccessAt: string | null;
      etagResources: number | null;
      erroredResources: number | null;
      lastHttpStatus: number | null;
    }>(
      `SELECT synced_at::text AS "syncedAt",
              health_status AS "healthStatus",
              last_error AS "lastError",
              last_success_at::text AS "lastSuccessAt",
              etag_resources AS "etagResources",
              errored_resources AS "erroredResources",
              last_http_status AS "lastHttpStatus"
       FROM tba_cache_freshness
       LIMIT 1`,
    );
    const first = row.rows[0];
    if (first) {
      freshness = {
        ...first,
        etagResources: first.etagResources == null ? null : Number(first.etagResources),
        erroredResources: first.erroredResources == null ? null : Number(first.erroredResources),
        lastHttpStatus: first.lastHttpStatus == null ? null : Number(first.lastHttpStatus),
      };
    }
  } catch {
    try {
      const legacy = await client.query<{
        syncedAt: string | null;
        healthStatus: string | null;
        lastError: string | null;
        lastSuccessAt: string | null;
      }>(
        `SELECT synced_at::text AS "syncedAt",
                health_status AS "healthStatus",
                last_error AS "lastError",
                last_success_at::text AS "lastSuccessAt"
         FROM tba_cache_freshness
         LIMIT 1`,
      );
      const first = legacy.rows[0];
      if (first) {
        freshness = { ...first, etagResources: null, erroredResources: null, lastHttpStatus: null };
      }
    } catch {
      freshness = null;
    }
  }

  return evaluateDataSourceHealth({
    healthRows,
    cursorRows,
    freshness,
    cacheHasRows,
    orgId,
  });
}
