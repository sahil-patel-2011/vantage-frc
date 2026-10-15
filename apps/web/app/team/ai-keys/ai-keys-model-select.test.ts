import { describe, expect, it } from "vitest";
import { modelChoicesFor } from "./ai-keys-model-select";
import type { ModelOption } from "./ai-keys-model";

const option = (provider: string, modelId: string, label: string, fixedOnly = false): ModelOption => ({
  id: `${provider}:${modelId}${fixedOnly ? "@x" : ""}`, provider, modelId, label, tier: "t", tierLabel: "T", ...(fixedOnly ? { fixedOnly } : {}),
});

describe("modelChoicesFor", () => {
  const options = [
    option("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5"),
    option("anthropic", "claude-haiku-5-5", "Claude Haiku 5.5 · Low effort", true),
    option("openai", "gpt-4.1-mini", "GPT-4.1 mini"),
  ];

  it("lists each model a provider's key can run once, without effort variants", () => {
    expect(modelChoicesFor("anthropic", options)).toEqual([{ modelId: "claude-haiku-5-5", label: "Claude Haiku 5.5" }]);
    expect(modelChoicesFor("openai", options).map((choice) => choice.modelId)).toEqual(["gpt-4.1-mini"]);
  });

  it("offers OpenRouter's free pool instead of a blank box", () => {
    expect(modelChoicesFor("openrouter", options)[0]?.modelId).toBe("openrouter/free");
  });
});
