import type { PoolClient } from "@neondatabase/serverless";
import type {
  ChatAdapter,
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
  ContextItem,
} from "./index";
import { buildVantageChatSystemPrompt } from "./chat-system-prompt";
import { ChatUpstreamTimeoutError, resolveChatFetchTimeoutMs } from "./chat-timeout";
import {
  applyAnthropicCacheControl,
  computeCacheAwareCost,
  openAiPromptCachePreference,
  parseAnthropicUsage,
  parseOpenAiUsage,
  type PromptCachePrices,
} from "./prompt-caching";

// Default upstream timeout lives in ./chat-timeout (50s — always shorter than the
// route's `maxDuration = 60`, so the abort fires before the platform kills the
// function). Override per-org-of-deployment with VANTAGE_CHAT_TIMEOUT_MS.
export {
  ChatUpstreamTimeoutError,
  DEFAULT_CHAT_FETCH_TIMEOUT_MS,
  isChatUpstreamTimeout,
  resolveChatFetchTimeoutMs,
} from "./chat-timeout";

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
      // Clean, classified timeout (name ChatUpstreamTimeoutError, status 504) —
      // never a hang, never an opaque AbortError.
      throw new ChatUpstreamTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export class HttpChatAdapter implements ChatAdapter {
  readonly provider: string;
  readonly model: string;
  readonly supportsNativeTools = true;
  private readonly apiKey: string;
  readonly baseUrl: string;
  private readonly kind: HttpChatAdapterConfig["provider"];
  private readonly promptCachingEnabled: boolean;
  private readonly prices: PromptCachePrices;
  private readonly fetchImpl: typeof fetch;
  private readonly providerLabel: string;
  private readonly timeoutMs: number;
  private readonly systemPrompt: string;
  private readonly capability: string;

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
    this.timeoutMs =
      config.timeoutMs ?? resolveChatFetchTimeoutMs(process.env.VANTAGE_CHAT_TIMEOUT_MS);
    this.capability = config.capability ?? "chat";
    this.systemPrompt = buildVantageChatSystemPrompt({ capability: this.capability });
    this.extraHeaders = config.extraHeaders ?? {};
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    history?: ChatMessage[];
    tools?: ChatToolDefinition[];
    promptCachingEnabled?: boolean;
  }) {
    const caching = input.promptCachingEnabled ?? this.promptCachingEnabled;
    if (this.kind === "anthropic") {
      return this.completeAnthropic(input.message, input.context, input.history ?? [], input.tools ?? [], caching);
    }
    return this.completeOpenAi(input.message, input.context, input.history ?? [], input.tools ?? [], caching);
  }

  estimateCostUsd(promptTokens: number, completionTokens: number): number {
    return (
      (Math.max(0, promptTokens) * this.prices.inputPerMillionUsd +
        Math.max(0, completionTokens) * this.prices.outputPerMillionUsd) /
      1_000_000
    );
  }

  private async completeAnthropic(
    message: string,
    context: ContextItem[],
    history: ChatMessage[],
    tools: ChatToolDefinition[],
    caching: boolean,
  ) {
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
          max_tokens: chatCompletionMaxTokens(this.capability),
          system: systemBlocks,
          messages: [...history, { role: "user", content: message }],
          ...(tools.length
            ? {
                tools: tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  input_schema: tool.inputSchema ?? {
                    type: "object",
                    additionalProperties: true,
                  },
                })),
              }
            : {}),
        }),
      },
      this.timeoutMs,
    );
    if (!response.ok) {
      throwIfHttpFailed(this.providerLabel, response.status, this.model);
    }
    const payload = (await response.json()) as {
      content?: Array<{ type?: string; text?: string; name?: string; id?: string; input?: unknown }>;
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
    const toolCalls = (payload.content ?? [])
      .filter((block) => block.type === "tool_use" && typeof block.name === "string")
      .map((block) => ({
        name: block.name!,
        input: block.input ?? {},
        callId: block.id,
      }));
    const parsed = parseAnthropicUsage(payload.usage ?? {});
    const priced = computeCacheAwareCost(parsed, this.prices);
    return {
      text: text || "No response.",
      ...(toolCalls.length ? { toolCalls } : {}),
      promptTokens: priced.promptTokens,
      completionTokens: priced.completionTokens,
      costUsd: priced.costUsd,
      cacheReadInputTokens: priced.cacheReadInputTokens,
      cacheWriteInputTokens: priced.cacheWriteInputTokens,
      uncachedInputTokens: priced.uncachedInputTokens,
      cacheCostBasis: priced.cacheCostBasis,
    };
  }

  private async completeOpenAi(
    message: string,
    context: ContextItem[],
    history: ChatMessage[],
    tools: ChatToolDefinition[],
    caching: boolean,
  ) {
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
            ...history,
            { role: "user", content: message },
          ],
          ...(tools.length
            ? {
                tools: tools.map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema ?? {
                      type: "object",
                      additionalProperties: true,
                    },
                  },
                })),
                tool_choice: "auto",
              }
            : {}),
          ...preference,
        }),
      },
      this.timeoutMs,
    );
    if (!response.ok) {
      throwIfHttpFailed(this.providerLabel, response.status, this.model);
    }
    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          tool_calls?: Array<{
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const responseMessage = payload.choices?.[0]?.message;
    const text = responseMessage?.content?.trim() || "No response.";
    const toolCalls = (responseMessage?.tool_calls ?? [])
      .map((call): ChatToolCall | null => {
        const name = call.function?.name?.trim();
        if (!name) return null;
        try {
          const parsed = JSON.parse(call.function?.arguments || "{}") as unknown;
          return { name, input: parsed, callId: call.id };
        } catch {
          return null;
        }
      })
      .filter((call): call is ChatToolCall => call !== null);
    const parsed = parseOpenAiUsage(payload.usage ?? {});
    const priced = computeCacheAwareCost(parsed, this.prices);
    return {
      text,
      ...(toolCalls.length ? { toolCalls } : {}),
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

export function chatCompletionMaxTokens(capability: string): number {
  return /^(agent|cad|coding|maintenance|bugbot)/i.test(capability.trim()) ? 4096 : 1024;
}

function defaultBase(provider: HttpChatAdapterConfig["provider"]) {
  if (provider === "anthropic") return "https://api.anthropic.com";
  return "https://api.openai.com/v1";
}

/**
 * Prompt caching is default-ON platform-wide (migration 0448). The org row is
 * the single source of truth when it exists — an explicit false is honored —
 * and a missing budget-policy row means the default: enabled.
 */
export async function getOrgPromptCachingEnabled(
  client: PoolClient,
  orgId: string,
): Promise<boolean> {
  const result = await client.query<{ enabled: boolean }>(
    `SELECT prompt_caching_enabled AS enabled
     FROM org_api_budget_policies WHERE org_id = $1`,
    [orgId],
  );
  const row = result.rows[0];
  return row ? Boolean(row.enabled) : true;
}
