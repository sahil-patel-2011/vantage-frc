import type { PoolClient } from "@neondatabase/serverless";

/** Compact TBA/Statbotics health note attached to chat tool provenance. */
export type ToolDataSourceNote = {
  mode: "ok" | "degraded" | "unavailable" | "stale";
  usingLastGoodCache: boolean;
  message: string;
};

const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

function isUnhealthy(status: string | null | undefined) {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "degraded" || normalized === "unavailable" || normalized === "failed";
}

export function classifyToolDataSourceNote(input: {
  healthStatus: string | null;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  cacheHasRows: boolean;
  now?: Date;
}): ToolDataSourceNote {
  const now = input.now ?? new Date();
  const unavailable = (input.healthStatus ?? "").trim().toLowerCase() === "unavailable";
  const unhealthy =
    isUnhealthy(input.healthStatus) ||
    input.consecutiveFailures > 0 ||
    Boolean(input.lastError);
  const successMs = input.lastSuccessAt ? Date.parse(input.lastSuccessAt) : NaN;
  const stale =
    !unhealthy &&
    input.cacheHasRows &&
    Number.isFinite(successMs) &&
    now.getTime() - successMs > STALE_AFTER_MS;

  if (unavailable && !input.cacheHasRows) {
    return {
      mode: "unavailable",
      usingLastGoodCache: false,
      message: input.lastError
        ? `TBA ingest unavailable (${input.lastError}). No last-good Neon cache yet.`
        : "TBA ingest unavailable and no last-good Neon cache yet.",
    };
  }

  if (unhealthy || unavailable) {
    const successLabel = input.lastSuccessAt
      ? new Date(input.lastSuccessAt).toISOString()
      : "unknown";
    return {
      mode: unavailable ? "unavailable" : "degraded",
      usingLastGoodCache: input.cacheHasRows,
      message: input.cacheHasRows
        ? `TBA ingest is degraded. Serving last-good Neon reference cache (last success ${successLabel}).`
        : input.lastError
          ? `TBA ingest is degraded (${input.lastError}).`
          : "TBA ingest is degraded.",
    };
  }

  if (stale) {
    return {
      mode: "stale",
      usingLastGoodCache: true,
      message: `No recent TBA sync success. Serving last-good Neon reference cache (last success ${new Date(successMs).toISOString()}).`,
    };
  }

  return {
    mode: "ok",
    usingLastGoodCache: false,
    message: "Reference ingest healthy; tools use the Neon reference cache.",
  };
}

export async function loadToolDataSourceNote(client: PoolClient): Promise<ToolDataSourceNote> {
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

  let healthStatus: string | null = null;
  let consecutiveFailures = 0;
  let lastSuccessAt: string | null = null;
  let lastError: string | null = null;
  try {
    const health = await client.query<{
      status: string;
      consecutiveFailures: number;
      lastSuccessAt: string | null;
      details: Record<string, unknown> | null;
    }>(
      `SELECT status,
              consecutive_failures AS "consecutiveFailures",
              last_success_at::text AS "lastSuccessAt",
              details
       FROM data_source_health
       WHERE source = 'tba'
       LIMIT 1`,
    );
    const row = health.rows[0];
    if (row) {
      healthStatus = row.status;
      consecutiveFailures = Number(row.consecutiveFailures ?? 0);
      lastSuccessAt = row.lastSuccessAt;
      lastError =
        row.details && typeof row.details.error === "string" ? row.details.error : null;
    }
  } catch {
    // Missing table/migration — treat as unknown/ok so chat still answers from cache.
  }

  return classifyToolDataSourceNote({
    healthStatus,
    consecutiveFailures,
    lastSuccessAt,
    lastError,
    cacheHasRows,
  });
}
