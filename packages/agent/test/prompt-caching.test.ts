import { describe, expect, it } from "vitest";
import {
  applyAnthropicCacheControl,
  computeCacheAwareCost,
  parseAnthropicUsage,
  parseOpenAiUsage,
  simulateLocalCacheUsage,
} from "../src/prompt-caching";

describe("prompt caching helpers", () => {
  it("marks non-final Anthropic blocks with ephemeral cache_control", () => {
    const blocks = applyAnthropicCacheControl(
      [
        { type: "text", text: "system" },
        { type: "text", text: "context" },
        { type: "text", text: "user" },
      ],
      true,
    );
    expect(blocks[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(blocks[1]).toMatchObject({ cache_control: { type: "ephemeral" } });
    expect(blocks[2]).not.toHaveProperty("cache_control");
  });

  it("computes cache-aware cost when rates exist", () => {
    const usage = parseAnthropicUsage({
      input_tokens: 1100,
      output_tokens: 100,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 200,
    });
    const priced = computeCacheAwareCost(usage, {
      inputPerMillionUsd: 3,
      outputPerMillionUsd: 15,
      cacheReadPerMillionUsd: 0.3,
      cacheWritePerMillionUsd: 3.75,
    });
    expect(priced.cacheCostBasis).toBe("provider_cache_rates");
    expect(priced.uncachedInputTokens).toBe(100);
    expect(priced.costUsd).toBeGreaterThan(0);
  });

  it("falls back to full input price when cache rates are unknown", () => {
    const usage = parseOpenAiUsage({
      prompt_tokens: 1000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 900 },
    });
    const priced = computeCacheAwareCost(usage, {
      inputPerMillionUsd: 2,
      outputPerMillionUsd: 8,
    });
    expect(priced.cacheCostBasis).toBe("full_input_fallback");
    expect(priced.costUsd).toBeCloseTo((1000 / 1e6) * 2 + (50 / 1e6) * 8, 6);
  });

  it("simulates local cache accounting when enabled", () => {
    const off = simulateLocalCacheUsage({
      message: "hello",
      contextChars: 40,
      completionChars: 20,
      enabled: false,
    });
    const on = simulateLocalCacheUsage({
      message: "hello",
      contextChars: 40,
      completionChars: 20,
      enabled: true,
    });
    expect(off.cacheReadInputTokens).toBe(0);
    expect(on.cacheReadInputTokens).toBeGreaterThan(0);
    expect(on.promptTokens).toBe(off.promptTokens);
  });
});
