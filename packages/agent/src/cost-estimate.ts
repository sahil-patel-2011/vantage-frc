/**
 * Pre-call cost estimates for metered AI. Every meteredAI call carries an
 * `estimatedCostUsd` that drives the hard-cutoff / PAYG / approval decisions BEFORE the
 * provider is called, so a hardcoded number silently disables those gates. This module
 * derives the estimate from the same prices the model router and the adapters use:
 *
 *   1. the adapter's own configured prices (org key rows, catalog rows, hosted defaults),
 *   2. the model_catalog row that matches the provider/model (what routeModel reads),
 *   3. the BYOK public-list snapshot (byok-model-routing.ts),
 *   4. a per-provider-family default — never $0 for a paid provider.
 *
 * Subscription-bridge, sponsored-pool, and local endpoints estimate $0: the subscriber,
 * the promo pool, or the shop laptop pays, and meteredAI books their ledger cost as 0.
 */

import type { PoolClient } from "@neondatabase/serverless";
import type { ModelConfig } from "./index";
import { BYOK_MODEL_OPTIONS } from "./byok-model-routing";
import type { PromptCachePrices } from "./prompt-caching";

export type CostEstimateInput = {
  /** Adapter provider label (anthropic, openai, openai-compatible, subscription-bridge, sponsored:groq, local…). */
  provider?: string | null;
  /** Provider model id or catalog display name. */
  model: string;
  /** Either token count or raw prompt characters (≈4 chars/token). */
  promptTokens?: number;
  promptChars?: number;
  /** Completion budget the call will allow. */
  maxTokens: number;
  /** model_catalog rows (see loadModelCatalog) — the prices routeModel reads. */
  catalog?: readonly ModelConfig[] | null;
  /** The adapter's own configured prices, when it exposes them. Wins over every lookup. */
  prices?: PromptCachePrices | null;
};

/** Providers whose turns Vantage books at $0 (someone else's bill, or no bill). */
export function isZeroCostProvider(provider: string | null | undefined): boolean {
  const value = (provider ?? "").trim().toLowerCase();
  if (!value) return false;
  return (
    value === "subscription-bridge" ||
    value === "local" ||
    value === "vantage-local" ||
    value === "openrouter" ||
    value.startsWith("sponsored")
  );
}

const FAMILY_DEFAULTS: Array<{ test: RegExp; prices: PromptCachePrices }> = [
  { test: /anthropic|claude/i, prices: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } },
  { test: /google|gemini/i, prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.4 } },
  { test: /openai|gpt/i, prices: { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 } },
];
const UNKNOWN_DEFAULT: PromptCachePrices = { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 };

/** Per-million prices for a provider/model, using the lookup order documented above. */
export function resolveModelPrices(input: {
  provider?: string | null;
  model: string;
  catalog?: readonly ModelConfig[] | null;
  prices?: PromptCachePrices | null;
}): PromptCachePrices {
  if (input.prices && Number.isFinite(input.prices.inputPerMillionUsd)) return input.prices;
  if (isZeroCostProvider(input.provider)) return { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };

  const model = input.model.trim();
  const provider = (input.provider ?? "").trim().toLowerCase();
  const catalogRow = findCatalogModel(input.catalog ?? null, provider, model);
  if (catalogRow) {
    return {
      inputPerMillionUsd: catalogRow.inputPricePerMillionUsd,
      outputPerMillionUsd: catalogRow.outputPricePerMillionUsd,
    };
  }

  const byok = BYOK_MODEL_OPTIONS.find(
    (option) =>
      option.modelId === model &&
      (!provider || option.provider === provider || provider === "openai-compatible"),
  );
  if (byok) return { inputPerMillionUsd: byok.inputPerMillionUsd, outputPerMillionUsd: byok.outputPerMillionUsd };

  const haystack = `${provider} ${model}`;
  const family = FAMILY_DEFAULTS.find((entry) => entry.test.test(haystack));
  return family?.prices ?? UNKNOWN_DEFAULT;
}

/** The catalog row an adapter's provider/model names — provider_model_id or display_name. */
export function findCatalogModel(
  catalog: readonly ModelConfig[] | null,
  provider: string,
  model: string,
): ModelConfig | null {
  if (!catalog?.length || !model) return null;
  const normalizedProvider = provider.trim().toLowerCase();
  const matches = catalog.filter(
    (row) => row.enabled && (row.providerModelId === model || row.displayName === model),
  );
  if (!matches.length) return null;
  return (
    matches.find((row) => row.provider.toLowerCase() === normalizedProvider) ??
    matches.find((row) => normalizedProvider && row.provider.toLowerCase().includes(normalizedProvider)) ??
    matches[0]!
  );
}

/**
 * USD estimate for one call. Rounded to 6 decimals to match ai_usage_events.cost_usd.
 * Never negative; $0 only for zero-cost providers or explicit zero prices.
 */
export function estimateCostUsd(input: CostEstimateInput): number {
  const promptTokens = Math.max(
    0,
    Math.ceil(input.promptTokens ?? (input.promptChars ?? 0) / 4),
  );
  const completionTokens = Math.max(0, Math.ceil(input.maxTokens));
  const prices = resolveModelPrices(input);
  const usd =
    (prices.inputPerMillionUsd * promptTokens + prices.outputPerMillionUsd * completionTokens) /
    1_000_000;
  return Math.round(Math.max(0, usd) * 1_000_000) / 1_000_000;
}

type CatalogRow = {
  id: string;
  displayName: string;
  provider: string;
  providerModelId: string | null;
  inputPrice: string | number | null;
  outputPrice: string | number | null;
  capabilities: string[] | null;
  eligiblePlans: string[] | null;
  paygOnly: boolean;
  enabled: boolean;
  routingWeight: string | number | null;
  contextWindowTokens: number | null;
  fundingMode: ModelConfig["fundingMode"] | null;
  commercialUseApproved: boolean | null;
  commercialApprovalSource: string | null;
  sponsoredEnabled: boolean | null;
};

/**
 * model_catalog as ModelConfig[] — the router's input. Reads with the request's RLS
 * client; the catalog is platform-wide readable. Returns [] (never throws) when the table
 * or newer columns are missing, so routing degrades to "no gating" instead of failing chat.
 * Runs inside a SAVEPOINT so a schema miss cannot abort the caller's transaction.
 */
export async function loadModelCatalog(client: PoolClient): Promise<ModelConfig[]> {
  const savepoint = await client
    .query("SAVEPOINT model_catalog_read")
    .then(() => true)
    .catch(() => false);
  try {
    const result = await client.query<CatalogRow>(
      `SELECT id::text AS id,
              display_name AS "displayName",
              provider,
              provider_model_id AS "providerModelId",
              input_price_per_million_usd AS "inputPrice",
              output_price_per_million_usd AS "outputPrice",
              capabilities,
              eligible_plans AS "eligiblePlans",
              payg_only AS "paygOnly",
              enabled,
              routing_weight AS "routingWeight",
              (to_jsonb(model_catalog) ->> 'context_window_tokens')::int AS "contextWindowTokens",
              (to_jsonb(model_catalog) ->> 'funding_mode') AS "fundingMode",
              (to_jsonb(model_catalog) ->> 'commercial_use_approved')::boolean AS "commercialUseApproved",
              (to_jsonb(model_catalog) ->> 'commercial_approval_source') AS "commercialApprovalSource",
              (to_jsonb(model_catalog) ->> 'sponsored_enabled')::boolean AS "sponsoredEnabled"
         FROM model_catalog`,
    );
    if (savepoint) await client.query("RELEASE SAVEPOINT model_catalog_read");
    return result.rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      provider: row.provider,
      providerModelId: row.providerModelId,
      inputPricePerMillionUsd: Number(row.inputPrice ?? 0) || 0,
      outputPricePerMillionUsd: Number(row.outputPrice ?? 0) || 0,
      capabilities: Array.isArray(row.capabilities) ? row.capabilities : [],
      eligiblePlans: Array.isArray(row.eligiblePlans) ? row.eligiblePlans : [],
      paygOnly: Boolean(row.paygOnly),
      enabled: Boolean(row.enabled),
      routingWeight: Number(row.routingWeight ?? 1) || 1,
      contextWindowTokens: row.contextWindowTokens ?? null,
      fundingMode: row.fundingMode ?? undefined,
      commercialUseApproved: row.commercialUseApproved ?? undefined,
      commercialApprovalSource: row.commercialApprovalSource ?? null,
      sponsoredEnabled: row.sponsoredEnabled ?? undefined,
    }));
  } catch {
    if (savepoint) {
      await client.query("ROLLBACK TO SAVEPOINT model_catalog_read").catch(() => undefined);
    }
    return [];
  }
}
