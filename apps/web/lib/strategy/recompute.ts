import type { PoolClient } from "@neondatabase/serverless";
import { computeStrategyView } from "./compute-strategy";
import { EMPTY_PREDICTION_COPY } from "./prediction-empty-copy";
import { strategyShellSetupSteps } from "./strategy-related";
import type { StrategyView } from "./types";

/** Explicit on-demand action — briefing and Strategy POST this to re-run predictMatch. */
export const STRATEGY_RECOMPUTE_ACTION = "recompute";

const CACHED_EPA_SOURCES = new Set(["tba", "statbotics"]);

export type StrategyRecomputeInput = {
  userId: string;
  requestedOrg: string | null;
  matchKey?: string | null;
};

export type StrategyRefreshRequest = {
  action?: unknown;
  refresh?: unknown;
};

function textOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function truthyFlag(value: unknown): boolean {
  if (value === true) return true;
  if (typeof value === "number") return value === 1;
  const text = textOrEmpty(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}

/** Briefing GET ?refresh=1 or POST { action: "recompute" } — never implied by load alone. */
export function briefingRequestsStrategyRefresh(input: StrategyRefreshRequest): boolean {
  const action = textOrEmpty(input.action).toLowerCase();
  if (action === STRATEGY_RECOMPUTE_ACTION || action === "refresh") return true;
  return truthyFlag(input.refresh);
}

/** Neon TBA / Statbotics cache only — DEMO (and anything else) is not a rating source. */
export function isCachedEpaSource(source: string | null | undefined): boolean {
  const normalized = textOrEmpty(source).toLowerCase();
  if (!normalized || normalized.includes("demo")) return false;
  return CACHED_EPA_SOURCES.has(normalized);
}

export function hasCachedEpa(
  sources: ReadonlyArray<{ source?: string | null }> | null | undefined,
): boolean {
  return Boolean(sources?.some((row) => isCachedEpaSource(row.source)));
}

/**
 * Engine coin-flip when both alliances rate 0 (no EPA). A real 50/50 from equal
 * cached EPA is allowed — this only flags the empty-EPA case.
 */
export function isEmptyEpaCoinFlip(
  prediction: { pRed?: number; pBlue?: number } | null | undefined,
  sources: ReadonlyArray<{ source?: string | null }> | null | undefined,
): boolean {
  if (hasCachedEpa(sources)) return false;
  const pRed = Number(prediction?.pRed);
  const pBlue = Number(prediction?.pBlue);
  if (!Number.isFinite(pRed) || !Number.isFinite(pBlue)) return true;
  return Math.abs(pRed - 0.5) < 1e-6 && Math.abs(pBlue - 0.5) < 1e-6;
}

function toEmptyView(
  view: StrategyView,
): Extract<StrategyView, { status: "setup_required" | "empty" }> {
  return {
    status: "empty",
    message: EMPTY_PREDICTION_COPY,
    steps: strategyShellSetupSteps(view.orgId),
    orgId: view.orgId,
    eventKey: view.eventKey,
    eventName: view.eventName,
    teamNumber: view.teamNumber,
    tbaConfigured: view.tbaConfigured,
    ...(view.tbaAccess ? { tbaAccess: view.tbaAccess } : {}),
    ...(view.referenceAccess ? { referenceAccess: view.referenceAccess } : {}),
    ...(view.dataSourceHealth ? { dataSourceHealth: view.dataSourceHealth } : {}),
    ...(view.gameRules ? { gameRules: view.gameRules } : {}),
    ...(view.engine ? { engine: view.engine } : {}),
    ...(view.productVersion ? { productVersion: view.productVersion } : {}),
  };
}

/**
 * After computeStrategyView (which already runs predictMatch from Neon cache):
 * drop DEMO sources; empty EPA stays empty — never a 50% guess.
 */
export function finalizeStrategyRecompute(view: StrategyView): StrategyView {
  if (view.status !== "live") return view;

  const cachedSources = view.sources.filter((row) => isCachedEpaSource(row.source));
  if (!cachedSources.length || isEmptyEpaCoinFlip(view.prediction, cachedSources)) {
    return toEmptyView(view);
  }

  return { ...view, sources: cachedSources };
}

/**
 * On-demand recompute: re-run computeStrategyView → predictMatch against the
 * Neon TBA/Statbotics last-good cache. Does not invent DEMO ratings.
 */
export async function recomputeStrategyView(
  client: PoolClient,
  input: StrategyRecomputeInput,
): Promise<StrategyView> {
  const view = await computeStrategyView(client, {
    userId: input.userId,
    requestedOrg: input.requestedOrg,
    matchKey: input.matchKey,
  });
  return finalizeStrategyRecompute(view);
}
