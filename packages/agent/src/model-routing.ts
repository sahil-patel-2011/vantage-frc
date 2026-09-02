/**
 * Wires routeModel (index.ts) into the live request path.
 *
 * The chat/agent routes resolve an adapter from the org's keys first; this step then
 * (a) produces a real pre-call cost estimate for meteredAI from the adapter's prices /
 * the catalog, and (b) for a HOSTED adapter — the only case where Vantage is the
 * payer — checks the model_catalog row against the org's plan: plan eligibility,
 * PAYG-only gating and sponsored funding rules from routeModel apply, and the
 * resulting billing bucket rides into meteredAI as metadata.paygOnly so the managed
 * usage decision sees it.
 *
 * BYOK / local / bridge / sponsored-pool adapters are never plan-gated here: the org
 * (or the subscriber / the promo pool) pays the provider directly.
 */

import type { PoolClient } from "@neondatabase/serverless";
import { routeModel, type ModelConfig } from "./index";
import { estimateCostUsd, findCatalogModel, loadModelCatalog } from "./cost-estimate";
import type { PromptCachePrices } from "./prompt-caching";
import type { ResolvedModelSource } from "./resolve-chat-adapter";

export type RoutedRequest = {
  estimatedCostUsd: number;
  /** routeModel's bucket when a catalog row governed the call; external otherwise. */
  billingBucket: "included" | "payg" | "sponsored" | "external_provider";
  /** True when the routed catalog model is PAYG-only — meteredAI reads metadata.paygOnly. */
  paygOnly: boolean;
  /** Catalog row id the adapter's model matched, when plan gating applied. */
  catalogModelId: string | null;
};

export type RouteAdapterInput = {
  orgId: string;
  adapter: { provider: string; model: string; prices?: PromptCachePrices | null };
  capability: string;
  /** From resolveOrgChatAdapterWithProvenance; undefined means "unknown → no plan gating". */
  modelSource?: ResolvedModelSource;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  /** Injected for tests; defaults to the DB catalog. */
  catalog?: ModelConfig[];
};

type OrgPlanFacts = { plan: string; accountTier: "free" | "paid"; paygEnabled: boolean };

async function loadOrgPlanFacts(client: PoolClient, orgId: string): Promise<OrgPlanFacts> {
  const tier = await client
    .query<{ tier: string | null }>(`SELECT tier::text AS tier FROM org_billing WHERE org_id = $1::uuid`, [orgId])
    .then((result) => result.rows[0]?.tier ?? null)
    .catch(() => null);
  const plan = await client
    .query<{ planCode: string | null }>(
      `SELECT plan_code AS "planCode" FROM org_plan_periods
        WHERE org_id = $1::uuid AND status = 'active' AND period_start <= now() AND period_end > now()
        ORDER BY period_start DESC LIMIT 1`,
      [orgId],
    )
    .then((result) => result.rows[0]?.planCode ?? null)
    .catch(() => null);
  const paygEnabled = await client
    .query<{ paygEnabled: boolean | null }>(
      `SELECT payg_enabled AS "paygEnabled" FROM org_usage_policies WHERE org_id = $1::uuid`,
      [orgId],
    )
    .then((result) => result.rows[0]?.paygEnabled === true)
    .catch(() => false);
  const accountTier: "free" | "paid" = !tier || tier === "free" ? "free" : "paid";
  return { plan: plan ?? (tier && tier !== "free" ? tier : "free"), accountTier, paygEnabled };
}

/**
 * Cost estimate + (hosted only) plan gating for an already-resolved adapter. Throws the
 * router's honest "No configured model is eligible…" error when a hosted model's catalog
 * row is not eligible for the org's plan, so the request is refused before any spend.
 */
export async function routeAdapterForRequest(
  client: PoolClient,
  input: RouteAdapterInput,
): Promise<RoutedRequest> {
  const catalog = input.catalog ?? (input.modelSource === "hosted" ? await loadModelCatalog(client) : []);
  const external: RoutedRequest = {
    estimatedCostUsd: estimateCostUsd({
      provider: input.adapter.provider,
      model: input.adapter.model,
      promptTokens: input.estimatedInputTokens,
      maxTokens: input.estimatedOutputTokens,
      catalog,
      prices: input.adapter.prices ?? null,
    }),
    billingBucket: "external_provider",
    paygOnly: false,
    catalogModelId: null,
  };
  if (input.modelSource !== "hosted") return external;

  const row = findCatalogModel(catalog, input.adapter.provider, input.adapter.model);
  if (!row) return external;

  const facts = await loadOrgPlanFacts(client, input.orgId);
  const routed = routeModel(catalog, {
    capability: input.capability,
    plan: facts.plan,
    paygEnabled: facts.paygEnabled,
    preferredDisplayName: row.displayName,
    estimatedInputTokens: input.estimatedInputTokens,
    estimatedOutputTokens: input.estimatedOutputTokens,
    accountTier: facts.accountTier,
  });
  if (routed.id !== row.id) {
    // routeModel silently picked a cheaper eligible model; the resolved adapter cannot
    // switch models here, so refuse honestly rather than bill an ineligible one.
    throw new Error(
      `${row.displayName} is not eligible for the ${facts.plan} plan` +
        (row.paygOnly && !facts.paygEnabled ? " (pay-as-you-go is not enabled)" : ""),
    );
  }
  return {
    estimatedCostUsd: Math.round(routed.estimatedCostUsd * 1_000_000) / 1_000_000,
    billingBucket: routed.billingBucket,
    paygOnly: routed.billingBucket === "payg",
    catalogModelId: routed.id,
  };
}
