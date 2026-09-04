import { createHash, randomBytes } from "node:crypto";

export const PLATFORM_FREEBUFF_RELAY_NAME = "frcvantagefreebuff relay";

export type LiveRelayStats = {
  ok: boolean;
  model: string | null;
  bind: string | null;
  upstreamOk: boolean | null;
  tokensIn: number;
  tokensOut: number;
  tokensOutPerSec: number;
  tokensDay: string | null;
  activeRequests: number;
  maxConcurrent: number;
  available: number;
  byFeature: Record<string, number>;
  isolation: string | null;
  error: string | null;
};

export function generateFreeRelayDeviceKey(): string {
  return `vr_${randomBytes(24).toString("hex")}`;
}

export function hashFreeRelayDeviceKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

export function freeRelayStatsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  const root = trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
  return `${root}/v1/stats`;
}

function safeCount(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function shapeLiveRelayStats(payload: unknown): LiveRelayStats | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const tokens = row.tokens && typeof row.tokens === "object" ? (row.tokens as Record<string, unknown>) : {};
  const concurrency =
    row.concurrency && typeof row.concurrency === "object" ? (row.concurrency as Record<string, unknown>) : {};
  const byFeature =
    concurrency.byFeature && typeof concurrency.byFeature === "object"
      ? Object.fromEntries(
          Object.entries(concurrency.byFeature as Record<string, unknown>).map(([key, value]) => [key, safeCount(value)]),
        )
      : {};
  return {
    ok: row.ok === true,
    model: typeof row.model === "string" ? row.model : null,
    bind: typeof row.bind === "string" ? row.bind : null,
    upstreamOk: typeof row.upstreamOk === "boolean" ? row.upstreamOk : null,
    tokensIn: safeCount(tokens.in),
    tokensOut: safeCount(tokens.out),
    tokensOutPerSec: safeCount(tokens.outPerSec),
    tokensDay: typeof tokens.day === "string" ? tokens.day : null,
    activeRequests: safeCount(concurrency.active ?? row.activeRequests),
    maxConcurrent: safeCount(concurrency.max ?? row.maxConcurrent),
    available: safeCount(concurrency.available),
    byFeature,
    isolation: typeof row.isolation === "string" ? row.isolation : null,
    error: null,
  };
}

export async function probeFreeRelayStats(input: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}): Promise<LiveRelayStats> {
  const url = freeRelayStatsUrl(input.baseUrl);
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        accept: "application/json",
      },
      signal: AbortSignal.timeout(6_000),
    });
    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      return {
        ...emptyStats(),
        error: `Relay returned ${response.status}`,
      };
    }
    return shapeLiveRelayStats(payload) ?? { ...emptyStats(), error: "Relay stats were not a recognised payload." };
  } catch (error) {
    return {
      ...emptyStats(),
      error: error instanceof Error ? error.message : "Relay is unreachable.",
    };
  }
}

function emptyStats(): LiveRelayStats {
  return {
    ok: false,
    model: null,
    bind: null,
    upstreamOk: null,
    tokensIn: 0,
    tokensOut: 0,
    tokensOutPerSec: 0,
    tokensDay: null,
    activeRequests: 0,
    maxConcurrent: 0,
    available: 0,
    byFeature: {},
    isolation: null,
    error: null,
  };
}
