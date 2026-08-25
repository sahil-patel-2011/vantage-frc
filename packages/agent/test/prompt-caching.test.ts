import { describe, expect, it } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  applyAnthropicCacheControl,
  computeCacheAwareCost,
  openAiPromptCachePreference,
  parseAnthropicUsage,
  parseOpenAiUsage,
  simulateLocalCacheUsage,
} from "../src/prompt-caching";
import { getOrgPromptCachingEnabled } from "../src/http-chat-adapter";

function hasCacheControl(block: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(block, "cache_control");
}

describe("applyAnthropicCacheControl placement", () => {
  it("puts the breakpoint on the LAST block (plus the stable first block)", () => {
    const blocks = applyAnthropicCacheControl(
      [
        { type: "text", text: "system" },
        { type: "text", text: "context-a" },
        { type: "text", text: "context-b" },
      ],
      true,
    );
    // Last block carries the breakpoint: everything up to and including it caches.
    expect(blocks[2]).toMatchObject({ cache_control: { type: "ephemeral" } });
    // First block (frozen system prompt) keeps a hit when later context changes.
    expect(blocks[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
    // Intermediate blocks never carry breakpoints.
    expect(hasCacheControl(blocks[1])).toBe(false);
  });

  it("stays within Anthropic's 4-breakpoint limit for long context arrays", () => {
    const blocks = applyAnthropicCacheControl(
      Array.from({ length: 12 }, (_, index) => ({
        type: "text",
        text: `block-${index}`,
      })),
      true,
    );
    const breakpoints = blocks.filter((block) => hasCacheControl(block)).length;
    expect(breakpoints).toBeGreaterThan(0);
    expect(breakpoints).toBeLessThanOrEqual(4);
  });

  it("marks a single-block system array on that block", () => {
    const blocks = applyAnthropicCacheControl([{ type: "text", text: "system" }], true);
    expect(blocks[0]).toMatchObject({ cache_control: { type: "ephemeral" } });
  });

  it("adds no cache_control blocks when disabled", () => {
    const blocks = applyAnthropicCacheControl(
      [
        { type: "text", text: "system" },
        { type: "text", text: "context" },
      ],
      false,
    );
    expect(blocks.some((block) => hasCacheControl(block))).toBe(false);
  });
});

describe("openAiPromptCachePreference", () => {
  it("sends no wire fields either way — strict upstreams must never 400", () => {
    // OpenAI-style caching is automatic; unknown top-level body fields are
    // rejected by api.openai.com, so the preference must degrade silently.
    expect(openAiPromptCachePreference(true)).toEqual({});
    expect(openAiPromptCachePreference(false)).toEqual({});
  });
});

describe("prompt caching default (org toggle)", () => {
  const fakeClient = (rows: Array<{ enabled: boolean }>) =>
    ({ query: async () => ({ rows }) }) as unknown as PoolClient;

  it("defaults to enabled when the org has no budget-policy row", async () => {
    await expect(getOrgPromptCachingEnabled(fakeClient([]), "org-1")).resolves.toBe(true);
  });

  it("honors an explicit org opt-out", async () => {
    await expect(
      getOrgPromptCachingEnabled(fakeClient([{ enabled: false }]), "org-1"),
    ).resolves.toBe(false);
  });

  it("honors an explicit org opt-in", async () => {
    await expect(
      getOrgPromptCachingEnabled(fakeClient([{ enabled: true }]), "org-1"),
    ).resolves.toBe(true);
  });
});

describe("cache-aware cost", () => {
  // Realistic Anthropic Sonnet-style rates.
  const prices = {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
    cacheReadPerMillionUsd: 0.3,
    cacheWritePerMillionUsd: 3.75,
  };

  it("prices a cache-write turn then a cache-read turn; the read turn beats uncached", () => {
    // Turn 1: 8000-token system prefix written to cache + 200 uncached tokens.
    const writeTurn = computeCacheAwareCost(
      parseAnthropicUsage({
        input_tokens: 8200,
        output_tokens: 400,
        cache_creation_input_tokens: 8000,
        cache_read_input_tokens: 0,
      }),
      prices,
    );
    expect(writeTurn.cacheCostBasis).toBe("provider_cache_rates");
    expect(writeTurn.cacheWriteInputTokens).toBe(8000);
    expect(writeTurn.uncachedInputTokens).toBe(200);
    expect(writeTurn.costUsd).toBeCloseTo(
      (200 / 1e6) * 3 + (8000 / 1e6) * 3.75 + (400 / 1e6) * 15,
      6,
    );

    // Turn 2: the same 8000-token prefix now served from cache.
    const readTurn = computeCacheAwareCost(
      parseAnthropicUsage({
        input_tokens: 8200,
        output_tokens: 400,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 8000,
      }),
      prices,
    );
    expect(readTurn.cacheReadInputTokens).toBe(8000);
    expect(readTurn.costUsd).toBeCloseTo(
      (200 / 1e6) * 3 + (8000 / 1e6) * 0.3 + (400 / 1e6) * 15,
      6,
    );

    // Same request without caching: full input list price.
    const uncachedTurn = computeCacheAwareCost(
      parseAnthropicUsage({ input_tokens: 8200, output_tokens: 400 }),
      prices,
    );
    expect(uncachedTurn.costUsd).toBeCloseTo((8200 / 1e6) * 3 + (400 / 1e6) * 15, 6);

    // The ledger records the SAVINGS: cache-read turn is cheaper than uncached.
    expect(readTurn.costUsd).toBeLessThan(uncachedTurn.costUsd);
    // And the write turn costs slightly more than uncached (1.25x on the prefix).
    expect(writeTurn.costUsd).toBeGreaterThan(uncachedTurn.costUsd);
  });

  it("computes cache-aware cost when rates exist", () => {
    const usage = parseAnthropicUsage({
      input_tokens: 1100,
      output_tokens: 100,
      cache_read_input_tokens: 800,
      cache_creation_input_tokens: 200,
    });
    const priced = computeCacheAwareCost(usage, prices);
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
});

describe("local simulation", () => {
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
