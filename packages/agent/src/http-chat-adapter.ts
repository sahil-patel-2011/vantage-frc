import type { PoolClient } from "@neondatabase/serverless";
import type { ChatAdapter, ContextItem } from "./index";
import { buildVantageChatSystemPrompt } from "./chat-system-prompt";
import {
  applyAnthropicCacheControl,
  computeCacheAwareCost,
  openAiPromptCachePreference,
  parseAnthropicUsage,
  parseOpenAiUsage,
  type PromptCachePrices,
} from "./prompt-caching";

/** Default upstream timeout for Soft-UI chat (Hobby-friendly). */
export const DEFAULT_CHAT_FETCH_TIMEOUT_MS = 25_000;

export type HttpChatAdapterConfig = {
  provider: "openai" | "anthropic" | "openai-compatible";
  model: string;
  apiKey: string;
  baseUrl?: string;
  promptCachingEnabled: boolean;
  prices: PromptCachePrices;
  fetchImpl?: typeof fetch;
  /** Human-readable label for errors (e.g. mistral / groq) — never log keys. */
  providerLabel?: string;
  /** Abort upstream after this many ms. */
  timeoutMs?: number;
  /** Soft-UI capability for system prompt (chat, strategy, …). */
  capability?: string;
  /** Extra headers (OpenRouter HTTP-Referer / X-Title). Never log values. */
  extraHeaders?: Record<string, string>;
};

/**
 * Distinct rate-limit / quota / payment failure so sponsored failover can try
 * the next provider (429 capacity, 402 payment/quota, 503 overload).
 */
export class ProviderRateLimitError extends Error {
  readonly status: number;
  constructor(message: string, status = 429) {
    super(message);
    this.name = "ProviderRateLimitError";
    this.status = status;
  }
}

/** HTTP statuses that should skip to the next sponsored provider, not hard-fail. */
export function isProviderQuotaOrCapacityStatus(status: number): boolean {
  return status === 402 || status === 429 || status === 503;
}

function throwIfHttpFailed(providerLabel: string, status: number, model?: string): void {
  const modelHint = model ? ` model=${model}` : "";
  if (status === 401 || status === 403) {
    throw new Error(
      `${providerLabel} API key was rejected (${status}${modelHint}). Update the key under Team → AI API keys.`,
    );
  }
  if (isProviderQuotaOrCapacityStatus(status)) {
    throw new ProviderRateLimitError(
      `${providerLabel} rate-limited, quota exhausted, or at capacity (${status}${modelHint})`,
      status,
    );
  }
  if (status === 408 || status === 504) {
    throw new Error(`${providerLabel} timed out or gateway timeout (${status}${modelHint})`);
  }
  throw new Error(`${providerLabel} chat failed (${status}${modelHint})`);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  if (timeoutMs <= 0) {
    return fetchImpl(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || /aborted/i.test(error.message))) {
      throw new Error(`Upstream chat request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class HttpChatAdapter implements ChatAdapter {
  readonly provider: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly kind: HttpChatAdapterConfig["provider"];
  private readonly promptCachingEnabled: boolean;
  private readonly prices: PromptCachePrices;
  private readonly fetchImpl: typeof fetch;
  private readonly providerLabel: string;
  private readonly timeoutMs: number;
  private readonly systemPrompt: string;

  private readonly extraHeaders: Record<string, string>;

  constructor(config: HttpChatAdapterConfig) {
    this.kind = config.provider;
    this.provider = config.provider === "openai-compatible" ? "openai-compatible" : config.provider;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? defaultBase(config.provider)).replace(/\/$/, "");
    this.promptCachingEnabled = config.promptCachingEnabled;
    this.prices = config.prices;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.providerLabel = config.providerLabel?.trim() || this.provider;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_CHAT_FETCH_TIMEOUT_MS;
    this.systemPrompt = buildVantageChatSystemPrompt({ capability: config.capability ?? "chat" });
    this.extraHeaders = config.extraHeaders ?? {};
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    promptCachingEnabled?: boolean;
  }) {
    const caching = input.promptCachingEnabled ?? this.promptCachingEnabled;
    if (this.kind === "anthropic") {
      return this.completeAnthropic(input.message, input.context, caching);
    }
    return this.completeOpenAi(input.message, input.context, caching);
  }

  private async completeAnthropic(message: string, context: ContextItem[], caching: boolean) {
    const systemBlocks = applyAnthropicCacheControl(
      [
        { type: "text", text: this.systemPrompt },
        ...context.map((item) => ({
          type: "text" as const,
          text: `[${item.type}:${item.id}] ${item.content}`,
        })),
      ],
      caching,
    );
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}/v1/messages`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system: systemBlocks,
          messages: [{ role: "user", content: message }],
        }),
      },
      this.timeoutMs,
    );
    if (!response.ok) {
      throwIfHttpFailed(this.providerLabel, response.status, this.model);
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const text = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("\n")
      .trim();
    const parsed = parseAnthropicUsage(payload.usage ?? {});
    const priced = computeCacheAwareCost(parsed, this.prices);
    return {
      text: text || "No response.",
      promptTokens: priced.promptTokens,
      completionTokens: priced.completionTokens,
      costUsd: priced.costUsd,
      cacheReadInputTokens: priced.cacheReadInputTokens,
      cacheWriteInputTokens: priced.cacheWriteInputTokens,
      uncachedInputTokens: priced.uncachedInputTokens,
      cacheCostBasis: priced.cacheCostBasis,
    };
  }

  private async completeOpenAi(message: string, context: ContextItem[], caching: boolean) {
    const preference = openAiPromptCachePreference(caching);
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...this.extraHeaders,
    };
    // Ollama and many local servers accept requests without Authorization.
    if (this.apiKey.trim()) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    const response = await fetchWithTimeout(
      this.fetchImpl,
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: "system",
              content: [
                this.systemPrompt,
                ...context.map((item) => `[${item.type}:${item.id}] ${item.content}`),
              ].join("\n"),
            },
            { role: "user", content: message },
          ],
          ...preference,
        }),
      },
      this.timeoutMs,
    );
    if (!response.ok) {
      throwIfHttpFailed(this.providerLabel, response.status, this.model);
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const text = payload.choices?.[0]?.message?.content?.trim() || "No response.";
    const parsed = parseOpenAiUsage(payload.usage ?? {});
    const priced = computeCacheAwareCost(parsed, this.prices);
    return {
      text,
      promptTokens: priced.promptTokens,
      completionTokens: priced.completionTokens,
      costUsd: priced.costUsd,
      cacheReadInputTokens: priced.cacheReadInputTokens,
      cacheWriteInputTokens: priced.cacheWriteInputTokens,
      uncachedInputTokens: priced.uncachedInputTokens,
      cacheCostBasis: priced.cacheCostBasis,
    };
  }
}

function defaultBase(provider: HttpChatAdapterConfig["provider"]) {
  if (provider === "anthropic") return "https://api.anthropic.com";
  return "https://api.openai.com/v1";
}

export async function getOrgPromptCachingEnabled(
  client: PoolClient,
  orgId: string,
): Promise<boolean> {
  const result = await client.query<{ enabled: boolean }>(
    `SELECT COALESCE(prompt_caching_enabled, false) AS enabled
     FROM org_api_budget_policies WHERE org_id = $1`,
    [orgId],
  );
  return Boolean(result.rows[0]?.enabled);
}
