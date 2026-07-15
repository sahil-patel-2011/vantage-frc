import { describe, expect, it } from "vitest";
import {
  Base44WorkspaceConnector,
  boundedContext,
  LocalDeterministicChatAdapter,
  routeModel,
  validateHostedProviderUrl,
  type ModelConfig,
} from "../src";

const models: ModelConfig[] = [
  {
    id: "sol",
    displayName: "GPT 5.6 Sol",
    provider: "configured-openai",
    providerModelId: "env-configured-sol",
    inputPricePerMillionUsd: 1,
    outputPricePerMillionUsd: 2,
    capabilities: ["strategy"],
    eligiblePlans: ["managed_20"],
    paygOnly: false,
    enabled: true,
    routingWeight: 1,
    contextWindowTokens: 100_000,
  },
  {
    id: "fable",
    displayName: "Fable 5",
    provider: "configured-fable",
    providerModelId: "env-configured-fable",
    inputPricePerMillionUsd: 3,
    outputPricePerMillionUsd: 6,
    capabilities: ["strategy"],
    eligiblePlans: ["managed_20"],
    paygOnly: true,
    enabled: true,
    routingWeight: 1,
    contextWindowTokens: 100_000,
  },
];

describe("model router", () => {
  it("keeps Fable PAYG-only and out of included allowance", () => {
    expect(
      routeModel(models, {
        capability: "strategy",
        plan: "managed_20",
        paygEnabled: false,
        preferredDisplayName: "Fable 5",
        estimatedInputTokens: 100,
        estimatedOutputTokens: 100,
      }).displayName,
    ).toBe("GPT 5.6 Sol");
    expect(
      routeModel(models, {
        capability: "strategy",
        plan: "managed_20",
        paygEnabled: true,
        preferredDisplayName: "Fable 5",
        estimatedInputTokens: 100,
        estimatedOutputTokens: 100,
      }).billingBucket,
    ).toBe("payg");
  });

  it("never invents a provider model id", () => {
    expect(() =>
      routeModel([{ ...models[0]!, providerModelId: null }], {
        capability: "strategy",
        plan: "managed_20",
        paygEnabled: true,
        estimatedInputTokens: 1,
        estimatedOutputTokens: 1,
      }),
    ).toThrow("No configured model");
  });
});

describe("custom provider boundaries", () => {
  it("blocks metadata/private targets and requires a relay for localhost", async () => {
    await expect(validateHostedProviderUrl("http://localhost:11434/v1")).rejects.toThrow("HTTPS");
    await expect(validateHostedProviderUrl("https://169.254.169.254/latest")).rejects.toThrow("blocked");
    await expect(validateHostedProviderUrl("https://192.168.1.2/v1")).rejects.toThrow("blocked");
  });
  it("keeps Base44 disabled without a documented metered transport", async () => {
    const connector = new Base44WorkspaceConnector({
      enabled: false,
      meteringMode: "unverified",
    });
    await expect(connector.invoke({ operation: "invoke_llm" })).rejects.toThrow("disabled");
  });
});

describe("bounded private and team context", () => {
  it("honors token budgets and explicit source types", async () => {
    const result = boundedContext([
      { type: "private_memory", id: "private", content: "a".repeat(20), importance: 1 },
      { type: "team_memory", id: "shared", content: "b".repeat(100), importance: 0.5 },
    ], 10);
    expect(result.items.map((item) => item.id)).toEqual(["private"]);
    const chat = await new LocalDeterministicChatAdapter().complete({
      message: "Plan",
      context: result.items,
    });
    expect(chat.text).toContain("private_memory:private");
    expect(chat.costUsd).toBe(0);
  });
});
