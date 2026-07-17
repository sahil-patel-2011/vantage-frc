/**
 * Prompt caching helpers for Anthropic Messages and OpenAI Chat Completions.
 *
 * Metering policy:
 * - When providers report cache read/write token counts, those are persisted on
 *   `ai_usage_events` and used for cost when catalog cache rates exist.
 * - When cache rates are unknown, cost falls back to full input list price so
 *   we never under-report spend. Metadata records `cacheCostBasis`.
 */

export type PromptCachePrices = {
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd?: number | null;
  cacheWritePerMillionUsd?: number | null;
};

export type PromptCacheUsage = {
  promptTokens: number;
  completionTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  uncachedInputTokens: number;
  costUsd: number;
  cacheCostBasis: "provider_cache_rates" | "full_input_fallback";
};

export type AnthropicContentBlock =
  | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }
  | Record<string, unknown>;

export function applyAnthropicCacheControl(
  blocks: Array<{ type: string; text: string }>,
  enabled: boolean,
): AnthropicContentBlock[] {
  if (!enabled || blocks.length === 0) return blocks;
  return blocks.map((block, index) => {
    if (index === blocks.length - 1) return block;
    return { ...block, cache_control: { type: "ephemeral" as const } };
  });
}

export function openAiPromptCachePreference(enabled: boolean): {
  promptCachingEnabled: boolean;
} {
  return { promptCachingEnabled: enabled };
}

export function parseAnthropicUsage(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): {
  promptTokens: number;
  completionTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  uncachedInputTokens: number;
} {
  const cacheRead = Math.max(0, Number(usage.cache_read_input_tokens ?? 0));
  const cacheWrite = Math.max(0, Number(usage.cache_creation_input_tokens ?? 0));
  const promptTokens = Math.max(0, Number(usage.input_tokens ?? 0));
  const uncached = Math.max(0, promptTokens - cacheRead - cacheWrite);
  return {
    promptTokens,
    completionTokens: Math.max(0, Number(usage.output_tokens ?? 0)),
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: cacheWrite,
    uncachedInputTokens: uncached,
  };
}

export function parseOpenAiUsage(usage: {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
}): {
  promptTokens: number;
  completionTokens: number;
  cacheReadInputTokens: number;
  cacheWriteInputTokens: number;
  uncachedInputTokens: number;
} {
  const promptTokens = Math.max(0, Number(usage.prompt_tokens ?? 0));
  const cacheRead = Math.max(0, Number(usage.prompt_tokens_details?.cached_tokens ?? 0));
  return {
    promptTokens,
    completionTokens: Math.max(0, Number(usage.completion_tokens ?? 0)),
    cacheReadInputTokens: cacheRead,
    cacheWriteInputTokens: 0,
    uncachedInputTokens: Math.max(0, promptTokens - cacheRead),
  };
}

export function computeCacheAwareCost(
  usage: {
    promptTokens: number;
    completionTokens: number;
    cacheReadInputTokens: number;
    cacheWriteInputTokens: number;
    uncachedInputTokens: number;
  },
  prices: PromptCachePrices,
): PromptCacheUsage {
  const hasCacheRates =
    prices.cacheReadPerMillionUsd != null &&
    Number.isFinite(prices.cacheReadPerMillionUsd) &&
    prices.cacheWritePerMillionUsd != null &&
    Number.isFinite(prices.cacheWritePerMillionUsd);

  const outputCost = (usage.completionTokens / 1_000_000) * prices.outputPerMillionUsd;

  if (!hasCacheRates) {
    const costUsd =
      (usage.promptTokens / 1_000_000) * prices.inputPerMillionUsd + outputCost;
    return {
      ...usage,
      costUsd: Number(costUsd.toFixed(6)),
      cacheCostBasis: "full_input_fallback",
    };
  }

  const costUsd =
    (usage.uncachedInputTokens / 1_000_000) * prices.inputPerMillionUsd +
    (usage.cacheReadInputTokens / 1_000_000) * Number(prices.cacheReadPerMillionUsd) +
    (usage.cacheWriteInputTokens / 1_000_000) * Number(prices.cacheWritePerMillionUsd) +
    outputCost;

  return {
    ...usage,
    costUsd: Number(costUsd.toFixed(6)),
    cacheCostBasis: "provider_cache_rates",
  };
}

export function simulateLocalCacheUsage(input: {
  message: string;
  contextChars: number;
  completionChars: number;
  enabled: boolean;
}): PromptCacheUsage {
  const messageTokens = Math.ceil(input.message.length / 4);
  const contextTokens = Math.ceil(input.contextChars / 4);
  const completionTokens = Math.ceil(input.completionChars / 4);
  if (!input.enabled) {
    return {
      promptTokens: messageTokens + contextTokens,
      completionTokens,
      cacheReadInputTokens: 0,
      cacheWriteInputTokens: 0,
      uncachedInputTokens: messageTokens + contextTokens,
      costUsd: 0,
      cacheCostBasis: "full_input_fallback",
    };
  }
  return {
    promptTokens: messageTokens + contextTokens,
    completionTokens,
    cacheReadInputTokens: contextTokens,
    cacheWriteInputTokens: 0,
    uncachedInputTokens: messageTokens,
    costUsd: 0,
    cacheCostBasis: "provider_cache_rates",
  };
}
