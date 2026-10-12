import { preferredTierForFeature } from "./byok-model-routing";
import { HttpChatAdapter, type HttpChatAdapterConfig } from "./http-chat-adapter";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_FREE_MODEL = "llama-3.1-8b-instant";
/** Official free-model router — avoids pinning a rotating `:free` slug. */
export const OPENROUTER_FREE_MODEL = "openrouter/free";
/** Vantage's own Anthropic key answers with Claude Haiku 5.5 for every feature. */
export const HOSTED_ANTHROPIC_MODEL = "claude-haiku-5-5";

const OPENROUTER_PRICES = { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };
// Anthropic published rates for Claude Haiku 5.5 (prompts up to 100K tokens; longer ones are
// billed at 5x through pricesForPrompt): 5m cache write = 1.25x input, cache read = 0.1x input.
// With these present, computeCacheAwareCost meters actual savings on hosted-key turns instead of
// falling back to full input list price.
const ANTHROPIC_HAIKU_PRICES = {
  inputPerMillionUsd: 0.1,
  outputPerMillionUsd: 0.5,
  cacheReadPerMillionUsd: 0.01,
  cacheWritePerMillionUsd: 0.125,
};

export function readOpenRouterApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.OPENROUTER_API_KEY?.trim();
  return key || null;
}

export function readAnthropicPlatformKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.ANTHROPIC_API_KEY?.trim();
  return key || null;
}

export function openRouterFreeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPENROUTER_FREE_MODEL?.trim() || OPENROUTER_FREE_MODEL;
}

export type FreeRelayConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  providerLabel: string;
};

export function readFreeRelayConfig(
  env: NodeJS.ProcessEnv = process.env,
): FreeRelayConfig | null {
  const baseUrl = env.FREE_RELAY_BASE_URL?.trim().replace(/\/+$/, "");
  if (!baseUrl) return null;
  return {
    baseUrl,
    apiKey: env.FREE_RELAY_API_KEY?.trim() || "local-relay",
    model: env.FREE_RELAY_MODEL?.trim() || OPENROUTER_FREE_MODEL,
    providerLabel: env.FREE_RELAY_PROVIDER?.trim() || "free-relay",
  };
}

export function hostedAnthropicModel(_feature?: string | null): string {
  return HOSTED_ANTHROPIC_MODEL;
}

/** Features the router treats as hard think at High effort; everything else at Medium. */
export function hostedAnthropicEffort(feature?: string | null): "medium" | "high" {
  return preferredTierForFeature(feature) === "high" ? "high" : "medium";
}

export function openRouterRequestHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const referer =
    env.OPENROUTER_HTTP_REFERER?.trim() ||
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    env.BETTER_AUTH_URL?.trim() ||
    "http://localhost:3001";
  return {
    "HTTP-Referer": referer,
    "X-Title": env.OPENROUTER_APP_TITLE?.trim() || "Vantage",
  };
}

export function tryCreateOpenRouterFreeAdapter(input?: {
  promptCachingEnabled?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  capability?: string;
}): HttpChatAdapter | null {
  const env = input?.env ?? process.env;
  const apiKey = readOpenRouterApiKey(env);
  if (!apiKey) return null;
  return new HttpChatAdapter({
    provider: "openai-compatible",
    model: openRouterFreeModel(env),
    apiKey,
    baseUrl: OPENROUTER_BASE_URL,
    promptCachingEnabled: input?.promptCachingEnabled ?? true,
    prices: OPENROUTER_PRICES,
    fetchImpl: input?.fetchImpl,
    providerLabel: "openrouter",
    capability: input?.capability ?? "chat",
    extraHeaders: openRouterRequestHeaders(env),
  });
}

export function tryCreateGroqFreeAdapter(input?: {
  promptCachingEnabled?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  capability?: string;
}): HttpChatAdapter | null {
  const env = input?.env ?? process.env;
  const apiKey = env.GROQ_API_KEY?.trim();
  if (!apiKey) return null;
  return new HttpChatAdapter({
    provider: "openai-compatible",
    model: env.GROQ_MODEL?.trim() || GROQ_FREE_MODEL,
    apiKey,
    baseUrl: GROQ_BASE_URL,
    promptCachingEnabled: input?.promptCachingEnabled ?? true,
    prices: OPENROUTER_PRICES,
    fetchImpl: input?.fetchImpl,
    providerLabel: "groq",
    capability: input?.capability ?? "chat",
  });
}

export function tryCreateFreeRelayAdapter(input?: {
  promptCachingEnabled?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  capability?: string;
}): HttpChatAdapter | null {
  const config = readFreeRelayConfig(input?.env ?? process.env);
  if (!config) return null;
  return new HttpChatAdapter({
    provider: "openai-compatible",
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    promptCachingEnabled: input?.promptCachingEnabled ?? true,
    prices: OPENROUTER_PRICES,
    fetchImpl: input?.fetchImpl,
    providerLabel: config.providerLabel,
    capability: input?.capability ?? "chat",
  });
}

export function tryCreateHostedAnthropicAdapter(input?: {
  promptCachingEnabled?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  feature?: string | null;
}): HttpChatAdapter | null {
  const env = input?.env ?? process.env;
  const apiKey = readAnthropicPlatformKey(env);
  if (!apiKey) return null;
  const model = hostedAnthropicModel(input?.feature);
  const config: HttpChatAdapterConfig = {
    provider: "anthropic",
    model,
    apiKey,
    promptCachingEnabled: input?.promptCachingEnabled ?? true,
    prices: ANTHROPIC_HAIKU_PRICES,
    effort: hostedAnthropicEffort(input?.feature),
    fetchImpl: input?.fetchImpl,
    providerLabel: "anthropic-hosted",
    capability: input?.feature ?? "chat",
  };
  return new HttpChatAdapter(config);
}
