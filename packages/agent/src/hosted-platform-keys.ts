import { preferredTierForFeature } from "./byok-model-routing";
import { resolveSelectableFreebuffModel } from "./freebuff-models";
import { HttpChatAdapter, type HttpChatAdapterConfig } from "./http-chat-adapter";
import { isLocalOrLanOrigin } from "./model-tier";
import { isPriorityFreebuffTeam } from "./priority-team";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
export const GROQ_FREE_MODEL = "llama-3.1-8b-instant";
/** Official free-model router — avoids pinning a rotating `:free` slug. */
export const OPENROUTER_FREE_MODEL = "openrouter/free";
export const HOSTED_ANTHROPIC_SONNET = "claude-sonnet-4-20250514";
export const HOSTED_ANTHROPIC_OPUS = "claude-opus-4-20250514";

const OPENROUTER_PRICES = { inputPerMillionUsd: 0, outputPerMillionUsd: 0 };
// Anthropic published cache rates: 5m cache write = 1.25x input, cache read =
// 0.1x input. With these present, computeCacheAwareCost meters actual savings
// on hosted-key turns instead of falling back to full input list price.
const ANTHROPIC_SONNET_PRICES = {
  inputPerMillionUsd: 3,
  outputPerMillionUsd: 15,
  cacheReadPerMillionUsd: 0.3,
  cacheWritePerMillionUsd: 3.75,
};
const ANTHROPIC_OPUS_PRICES = {
  inputPerMillionUsd: 15,
  outputPerMillionUsd: 75,
  cacheReadPerMillionUsd: 1.5,
  cacheWritePerMillionUsd: 18.75,
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

/**
 * Why a config can be present in env yet refused. Surfaced at grant time so an
 * operator sees the reason then, rather than as a team's chat breaking later.
 */
export type FreeRelayRefusal = "unset" | "public_url_without_key";

/** Comma / semicolon / whitespace / pipe-separated tunnel URLs (one per Pi). */
export function parseFreeRelayBaseUrls(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of raw.split(/[\s,;|]+/)) {
    const url = part.trim().replace(/\/+$/, "");
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
}

export function freeRelayRefusal(env: NodeJS.ProcessEnv = process.env): FreeRelayRefusal | null {
  const urls = parseFreeRelayBaseUrls(env.FREE_RELAY_BASE_URL);
  if (urls.length === 0) return "unset";
  if (!env.FREE_RELAY_API_KEY?.trim() && urls.some((url) => !isLocalOrLanOrigin(url))) {
    return "public_url_without_key";
  }
  return null;
}

export function describeFreeRelayRefusal(refusal: FreeRelayRefusal): string {
  if (refusal === "unset") {
    return "This deployment has no free relay configured (FREE_RELAY_BASE_URL is unset).";
  }
  return "The free relay base URL is not loopback or LAN, so FREE_RELAY_API_KEY is required — an internet-reachable relay without a key would serve free AI on the platform's own upstream token to anyone who finds the URL.";
}

export function readFreeRelayConfigs(
  env: NodeJS.ProcessEnv = process.env,
): FreeRelayConfig[] {
  if (freeRelayRefusal(env)) return [];
  const urls = parseFreeRelayBaseUrls(env.FREE_RELAY_BASE_URL);
  const apiKey = env.FREE_RELAY_API_KEY?.trim();
  const model = resolveSelectableFreebuffModel(env.FREE_RELAY_MODEL);
  const providerLabel = env.FREE_RELAY_PROVIDER?.trim() || "free-relay";
  return urls
    .filter((baseUrl) => Boolean(apiKey) || isLocalOrLanOrigin(baseUrl))
    .map((baseUrl) => ({
      baseUrl,
      apiKey: apiKey || "local-relay",
      model,
      providerLabel,
    }));
}

export function readFreeRelayConfig(
  env: NodeJS.ProcessEnv = process.env,
): FreeRelayConfig | null {
  return readFreeRelayConfigs(env)[0] ?? null;
}

export function freeRelayPoolLabel(config: FreeRelayConfig): string {
  try {
    const url = new URL(config.baseUrl);
    const port = url.port ? `:${url.port}` : "";
    return `${config.providerLabel}:${url.hostname}${port}`;
  } catch {
    return config.providerLabel;
  }
}

export function freeRelayExtraHeaders(input: {
  capability: string;
  orgId?: string | null;
  teamNumber?: number | null;
}): Record<string, string> {
  const headers: Record<string, string> = {
    "x-vantage-feature": input.capability.slice(0, 48),
  };
  const orgId = input.orgId?.trim().toLowerCase() ?? "";
  if (orgId) headers["x-vantage-org-id"] = orgId.slice(0, 36);
  if (input.teamNumber != null && Number.isFinite(input.teamNumber)) {
    headers["x-vantage-team-number"] = String(Math.floor(Number(input.teamNumber)));
  }
  if (isPriorityFreebuffTeam(input.teamNumber)) {
    headers["x-vantage-priority"] = "1";
  }
  return headers;
}

export function hostedAnthropicModel(feature?: string | null): string {
  return preferredTierForFeature(feature) === "high" ? HOSTED_ANTHROPIC_OPUS : HOSTED_ANTHROPIC_SONNET;
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
  /** Team-picked Freebuff slug. DeepSeek V4 Flash is the free default. */
  model?: string | null;
  /** Isolates the Pi coding folder. Never send another org's id. */
  orgId?: string | null;
  /** FRC team number — 6925 is default-fast on the shared pool. */
  teamNumber?: number | null;
  /** One tunnel from a multi-URL pool. Defaults to the first configured URL. */
  config?: FreeRelayConfig;
}): HttpChatAdapter | null {
  const config = input?.config ?? readFreeRelayConfig(input?.env ?? process.env);
  if (!config) return null;
  const capability = input?.capability ?? "chat";
  const longJob = /^(cad|coding|bugbot|maintenance)/i.test(capability);
  return new HttpChatAdapter({
    provider: "openai-compatible",
    model: resolveSelectableFreebuffModel(input?.model ?? config.model),
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    promptCachingEnabled: input?.promptCachingEnabled ?? true,
    prices: OPENROUTER_PRICES,
    fetchImpl: input?.fetchImpl,
    providerLabel: config.providerLabel,
    capability,
    // Official Freebuff is a chat completion, not OpenAI tools. Vantage runs CAD
    // hops and scouting tools itself after the model answers.
    supportsNativeTools: false,
    timeoutMs: longJob ? 180_000 : undefined,
    extraHeaders: freeRelayExtraHeaders({
      capability,
      orgId: input?.orgId,
      teamNumber: input?.teamNumber,
    }),
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
  const prices = model === HOSTED_ANTHROPIC_OPUS ? ANTHROPIC_OPUS_PRICES : ANTHROPIC_SONNET_PRICES;
  const config: HttpChatAdapterConfig = {
    provider: "anthropic",
    model,
    apiKey,
    promptCachingEnabled: input?.promptCachingEnabled ?? true,
    prices,
    fetchImpl: input?.fetchImpl,
    providerLabel: "anthropic-hosted",
    capability: input?.feature ?? "chat",
  };
  return new HttpChatAdapter(config);
}
