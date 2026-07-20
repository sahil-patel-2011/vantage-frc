import type { PoolClient } from "@neondatabase/serverless";
import type { ChatAdapter, ContextItem } from "./index";
import {
  applyAnthropicCacheControl,
  computeCacheAwareCost,
  openAiPromptCachePreference,
  parseAnthropicUsage,
  parseOpenAiUsage,
  type PromptCachePrices,
} from "./prompt-caching";

export type HttpChatAdapterConfig = {
  provider: "openai" | "anthropic" | "openai-compatible";
  model: string;
  apiKey: string;
  baseUrl?: string;
  promptCachingEnabled: boolean;
  prices: PromptCachePrices;
  fetchImpl?: typeof fetch;
};

export class HttpChatAdapter implements ChatAdapter {
  readonly provider: string;
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly kind: HttpChatAdapterConfig["provider"];
  private readonly promptCachingEnabled: boolean;
  private readonly prices: PromptCachePrices;
  private readonly fetchImpl: typeof fetch;

  constructor(config: HttpChatAdapterConfig) {
    this.kind = config.provider;
    this.provider = config.provider === "openai-compatible" ? "openai-compatible" : config.provider;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? defaultBase(config.provider)).replace(/\/$/, "");
    this.promptCachingEnabled = config.promptCachingEnabled;
    this.prices = config.prices;
    this.fetchImpl = config.fetchImpl ?? fetch;
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
        { type: "text", text: "You are Vantage, an FRC team operations assistant. Prefer grounded facts." },
        ...context.map((item) => ({
          type: "text" as const,
          text: `[${item.type}:${item.id}] ${item.content}`,
        })),
      ],
      caching,
    );
    const response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
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
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Anthropic API key was rejected (${response.status}). Update the key under Team → AI API keys.`,
        );
      }
      throw new Error(`Anthropic chat failed (${response.status})`);
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
    };
    // Ollama and many local servers accept requests without Authorization.
    if (this.apiKey.trim()) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: "system",
            content: [
              "You are Vantage, an FRC team operations assistant.",
              ...context.map((item) => `[${item.type}:${item.id}] ${item.content}`),
            ].join("\n"),
          },
          { role: "user", content: message },
        ],
        ...preference,
      }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `OpenAI-compatible API key was rejected (${response.status}). Update the key under Team → AI API keys.`,
        );
      }
      throw new Error(`OpenAI-compatible chat failed (${response.status})`);
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
