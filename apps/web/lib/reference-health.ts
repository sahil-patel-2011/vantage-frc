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
  const names = sources.map((s) => (s.source === "tba" ? "The Blue Alliance" : s.source === "statbotics" ? "Statbotics" : s.source)).join(" / ") || "The Blue Alliance";
  const lastError = sources.map((s) => s.lastError).find(Boolean) ?? null;
  const lastSuccess = sources
    .map((s) => s.lastSuccessAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const successLabel = lastSuccess ? new Date(lastSuccess).toLocaleString() : "unknown";

  if (mode === "ok") {
    return {
      bannerTitle: "Rankings and schedule are up to date",
      bannerDetail: `${names} is up to date. Strategy uses the last saved rankings and schedule.`,
    };
  }

  if (mode === "unavailable" && !cacheHasRows) {
    return {
      bannerTitle: "Could not reach The Blue Alliance",
      bannerDetail: lastError
        ? `${names} is down (${lastError}). Nothing is saved on this team yet. Rankings stay blank until the source is back.`
        : `${names} is down and this team has no saved rankings yet.`,
    };
  }

  if (mode === "stale") {
    return {
      bannerTitle: "Rankings may be out of date",
      bannerDetail: `No recent successful ${names} update (last success ${successLabel}). Strategy is using the last saved rankings, not a live pull.`,
    };
  }

  return {
    bannerTitle: "Could not refresh rankings",
    bannerDetail: lastError
      ? `${names} is having trouble (${lastError}). Strategy still uses the last saved rankings (updated ${successLabel}).`
      : `${names} is having trouble. Strategy still uses the last saved rankings (last success ${successLabel}).`,
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

  // A source that succeeded after its last failure has recovered: its leftover lastError is history.
  // One resource with a bad ETag among hundreds is not the source being down either. Both used to
  // put "Last saved data" and the degraded banner over live data.
  const recovered = (source: ReferenceSourceHealth) =>
    Boolean(source.lastSuccessAt) &&
    (!source.lastFailureAt || Date.parse(source.lastSuccessAt!) > Date.parse(source.lastFailureAt));
  const unhealthy = sources.some(
    (source) =>
      isUnhealthyStatus(source.status) ||
      source.consecutiveFailures > 0 ||
      (Boolean(source.lastError) && !recovered(source)),
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

type HealthInputs = Omit<Parameters<typeof evaluateDataSourceHealth>[0], "orgId">;

/** How long one instance reuses the shared reference-sync health before reading it again. */
export const DATA_SOURCE_HEALTH_TTL_MS = 30_000;
let healthMemo: { at: number; inputs: Promise<HealthInputs> } | null = null;

/** Test hook: forget the memoized health so the next load reads the database. */
export function resetDataSourceHealthMemo() {
  healthMemo = null;
}

/**
 * The TBA/Statbotics sync health is the same for every team (shared reference tables, one ingest
 * worker), yet Home, Command, Dossier and Team data each re-read it with five queries on every
 * request. One read per instance per 30 seconds is plenty for a banner the worker updates in minutes.
 */
export async function loadDataSourceHealth(
  client: PoolClient,
  orgId?: string | null,
): Promise<DataSourceHealthView> {
  const now = Date.now();
  if (!healthMemo || now - healthMemo.at >= DATA_SOURCE_HEALTH_TTL_MS) {
    const inputs = readHealthInputs(client);
    healthMemo = { at: now, inputs };
    // A failed read is never reused.
    inputs.catch(() => {
      if (healthMemo?.inputs === inputs) healthMemo = null;
    });
  }
  return evaluateDataSourceHealth({ ...(await healthMemo.inputs), orgId });
}

async function readHealthInputs(client: PoolClient): Promise<HealthInputs> {
  let cacheHasRows: boolean;
  try {
    const cache = await client.query<{ ok: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM matches_ref LIMIT 1)
              OR EXISTS(SELECT 1 FROM team_event_metrics LIMIT 1)
              OR EXISTS(SELECT 1 FROM events_ref LIMIT 1) AS ok`,
    );
    cacheHasRows = Boolean(cache.rows[0]?.ok);
  } catch {
    // Unknown is not "empty": a failed check used to claim no saved rankings exist and raise the
    // "Rankings and schedule unavailable" banner over a full cache.
    cacheHasRows = true;
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
    // stays []
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
    // stays []
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

  return { healthRows, cursorRows, freshness, cacheHasRows };
}
