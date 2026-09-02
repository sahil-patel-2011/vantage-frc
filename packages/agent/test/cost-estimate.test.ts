import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import type { ModelConfig } from "../src";
import { estimateCostUsd, findCatalogModel, isZeroCostProvider, resolveModelPrices } from "../src/cost-estimate";
import { routeAdapterForRequest } from "../src/model-routing";

const catalog: ModelConfig[] = [
  {
    id: "sol",
    displayName: "GPT 5.6 Sol",
    provider: "openai",
    providerModelId: "gpt-5.6-sol",
    inputPricePerMillionUsd: 1,
    outputPricePerMillionUsd: 2,
    capabilities: ["chat", "agent"],
    eligiblePlans: ["managed_20"],
    paygOnly: false,
    enabled: true,
    routingWeight: 1,
    contextWindowTokens: 100_000,
    fundingMode: "managed_paid",
  },
  {
    id: "fable",
    displayName: "Fable 5",
    provider: "fable",
    providerModelId: "fable-5",
    inputPricePerMillionUsd: 3,
    outputPricePerMillionUsd: 6,
    capabilities: ["chat"],
    eligiblePlans: ["managed_20"],
    paygOnly: true,
    enabled: true,
    routingWeight: 1,
    contextWindowTokens: 100_000,
    fundingMode: "managed_paid",
  },
];

describe("estimateCostUsd", () => {
  it("prefers the adapter's own prices, then the catalog, then BYOK list rates, then family defaults", () => {
    expect(
      estimateCostUsd({
        provider: "openai",
        model: "gpt-5.6-sol",
        promptTokens: 1_000_000,
        maxTokens: 0,
        prices: { inputPerMillionUsd: 10, outputPerMillionUsd: 0 },
      }),
    ).toBe(10);
    expect(estimateCostUsd({ provider: "openai", model: "gpt-5.6-sol", promptTokens: 1_000_000, maxTokens: 0, catalog })).toBe(1);
    expect(resolveModelPrices({ provider: "anthropic", model: "claude-haiku-4-5" }).inputPerMillionUsd).toBe(1);
    expect(resolveModelPrices({ provider: "anthropic", model: "claude-unknown-9" }).inputPerMillionUsd).toBe(3);
    expect(resolveModelPrices({ provider: "openai-compatible", model: "llama-3" }).inputPerMillionUsd).toBe(0.4);
  });

  it("is never $0 for a paid provider and always $0 for bridge / sponsored / local", () => {
    expect(estimateCostUsd({ provider: "anthropic", model: "claude-sonnet-4-20250514", promptChars: 4000, maxTokens: 700 })).toBeGreaterThan(0);
    expect(estimateCostUsd({ provider: "subscription-bridge", model: "claude-code", promptChars: 4000, maxTokens: 700 })).toBe(0);
    expect(estimateCostUsd({ provider: "sponsored:groq", model: "llama", promptChars: 4000, maxTokens: 700 })).toBe(0);
    expect(estimateCostUsd({ provider: "local", model: "vantage-local-chat-v1", promptChars: 4000, maxTokens: 700 })).toBe(0);
    expect(isZeroCostProvider("openrouter")).toBe(true);
    expect(isZeroCostProvider("openai")).toBe(false);
  });

  it("matches catalog rows by provider model id or display name", () => {
    expect(findCatalogModel(catalog, "openai", "gpt-5.6-sol")?.id).toBe("sol");
    expect(findCatalogModel(catalog, "anthropic", "Fable 5")?.id).toBe("fable");
    expect(findCatalogModel(catalog, "openai", "gpt-4.1-mini")).toBeNull();
  });
});

function planClient(facts: { tier: string; planCode: string | null; payg: boolean }) {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM org_billing")) return { rows: [{ tier: facts.tier }], rowCount: 1 };
      if (sql.includes("FROM org_plan_periods")) {
        return facts.planCode ? { rows: [{ planCode: facts.planCode }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM org_usage_policies")) return { rows: [{ paygEnabled: facts.payg }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }),
  } as unknown as PoolClient;
}

describe("routeAdapterForRequest", () => {
  it("only estimates cost for BYOK / bridge adapters (no plan gating)", async () => {
    const routed = await routeAdapterForRequest(planClient({ tier: "free", planCode: null, payg: false }), {
      orgId: "org-1",
      adapter: { provider: "anthropic", model: "claude-sonnet-4-20250514", prices: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 } },
      capability: "chat",
      modelSource: "org-key",
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 700,
      catalog,
    });
    expect(routed.billingBucket).toBe("external_provider");
    expect(routed.paygOnly).toBe(false);
    expect(routed.estimatedCostUsd).toBeCloseTo((3 * 1000 + 15 * 700) / 1_000_000, 6);
  });

  it("routes a hosted catalog model through routeModel: included vs PAYG vs refused", async () => {
    const included = await routeAdapterForRequest(planClient({ tier: "team", planCode: "managed_20", payg: false }), {
      orgId: "org-1",
      adapter: { provider: "openai", model: "gpt-5.6-sol" },
      capability: "chat",
      modelSource: "hosted",
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
      catalog,
    });
    expect(included.billingBucket).toBe("included");
    expect(included.catalogModelId).toBe("sol");
    expect(included.estimatedCostUsd).toBeCloseTo((1 * 1000 + 2 * 500) / 1_000_000, 6);

    const payg = await routeAdapterForRequest(planClient({ tier: "team", planCode: "managed_20", payg: true }), {
      orgId: "org-1",
      adapter: { provider: "fable", model: "fable-5" },
      capability: "chat",
      modelSource: "hosted",
      estimatedInputTokens: 1,
      estimatedOutputTokens: 1,
      catalog,
    });
    expect(payg.billingBucket).toBe("payg");
    expect(payg.paygOnly).toBe(true);

    await expect(
      routeAdapterForRequest(planClient({ tier: "team", planCode: "managed_20", payg: false }), {
        orgId: "org-1",
        adapter: { provider: "fable", model: "fable-5" },
        capability: "chat",
        modelSource: "hosted",
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        catalog,
      }),
    ).rejects.toThrow(/not eligible.*pay-as-you-go/);

    await expect(
      routeAdapterForRequest(planClient({ tier: "free", planCode: null, payg: false }), {
        orgId: "org-1",
        adapter: { provider: "openai", model: "gpt-5.6-sol" },
        capability: "chat",
        modelSource: "hosted",
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
        catalog,
      }),
    ).rejects.toThrow(/No configured model is eligible/);
  });

  it("leaves a hosted model that is not in the catalog ungated but still priced", async () => {
    const routed = await routeAdapterForRequest(planClient({ tier: "free", planCode: null, payg: false }), {
      orgId: "org-1",
      adapter: { provider: "anthropic", model: "claude-sonnet-4-20250514" },
      capability: "chat",
      modelSource: "hosted",
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 1000,
      catalog,
    });
    expect(routed.billingBucket).toBe("external_provider");
    expect(routed.estimatedCostUsd).toBeGreaterThan(0);
  });
});
