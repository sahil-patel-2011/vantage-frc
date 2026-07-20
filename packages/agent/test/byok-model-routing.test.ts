import { describe, expect, it } from "vitest";
import {
  estimateByokCostUsd,
  pickByokModelForFeature,
  preferredTierForFeature,
} from "../src/byok-model-routing";
import {
  describeOpenAiCompatibleReachability,
  validateOpenAiCompatibleBaseUrl,
} from "../src/providers";

describe("BYOK automode routing", () => {
  it("maps CAD/code to high and strategy to mid", () => {
    expect(preferredTierForFeature("cad")).toBe("high");
    expect(preferredTierForFeature("coding")).toBe("high");
    expect(preferredTierForFeature("strategy")).toBe("mid");
    expect(preferredTierForFeature("chat")).toBe("fast");
  });

  it("picks high-reasoning models for CAD when available", () => {
    const picked = pickByokModelForFeature({
      feature: "cad",
      mode: "automode",
      enabledModelIds: [
        "openai:gpt-4.1",
        "openai:gpt-4.1-mini",
        "anthropic:claude-sonnet-4-20250514",
      ],
      availableProviders: ["openai", "anthropic"],
    });
    expect(picked?.tier).toBe("high");
    expect(picked?.modelId).toBe("gpt-4.1");
  });

  it("honors fixed model when set", () => {
    const picked = pickByokModelForFeature({
      feature: "cad",
      mode: "fixed",
      fixedModelId: "openai:gpt-4.1-mini",
      availableProviders: ["openai"],
    });
    expect(picked?.id).toBe("openai:gpt-4.1-mini");
  });

  it("estimates cost from public list rates without inventing tokens", () => {
    const cost = estimateByokCostUsd({
      provider: "openai",
      model: "gpt-4.1-mini",
      promptTokens: 1_000_000,
      completionTokens: 0,
    });
    expect(cost).toBe(0.4);
  });
});

describe("OpenAI-compatible base URL validation", () => {
  it("allows loopback Ollama URLs and warns about cloud reachability", async () => {
    await expect(validateOpenAiCompatibleBaseUrl("http://localhost:11434/v1")).resolves.toContain(
      "localhost:11434",
    );
    expect(describeOpenAiCompatibleReachability("http://127.0.0.1:1234/v1").loopback).toBe(true);
    expect(describeOpenAiCompatibleReachability("http://127.0.0.1:1234/v1").warning).toMatch(/localhost/i);
  });

  it("still blocks metadata SSRF targets", async () => {
    await expect(validateOpenAiCompatibleBaseUrl("https://169.254.169.254/latest")).rejects.toThrow(
      /blocked/i,
    );
  });
});
