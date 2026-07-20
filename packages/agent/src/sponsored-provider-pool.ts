import type { ChatAdapter, ContextItem } from "./index";
import { HttpChatAdapter, ProviderRateLimitError } from "./http-chat-adapter";

/**
 * Platform-sponsored promotional AI pool (env keys only — never commit values).
 * Env: MISTRAL_API_KEY, CEREBRAS_API_KEY, GROQ_API_KEY, COHERE_API_KEY
 * Order: Mistral (primary free/promo) → Cerebras → Groq → Cohere.
 * Cheap OpenAI-compatible models; failover on rate-limit / quota (429/503).
 */

export type SponsoredProviderId = "mistral" | "cerebras" | "groq" | "cohere";

type SponsoredCandidate = {
  id: SponsoredProviderId;
  envKey: string;
  baseUrl: string;
  model: string;
  /** Nominal $/M tokens for ledger metadata only (Vantage charge is $0). */
  prices: { inputPerMillionUsd: number; outputPerMillionUsd: number };
};

/** Prefer small / fast free-tier friendly models. */
export const SPONSORED_PROVIDER_ORDER: SponsoredCandidate[] = [
  {
    id: "mistral",
    envKey: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.3 },
  },
  {
    id: "cerebras",
    envKey: "CEREBRAS_API_KEY",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama3.1-8b",
    prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.1 },
  },
  {
    id: "groq",
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.1-8b-instant",
    prices: { inputPerMillionUsd: 0.05, outputPerMillionUsd: 0.08 },
  },
  {
    id: "cohere",
    envKey: "COHERE_API_KEY",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    model: "command-r-08-2024",
    prices: { inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
  },
];

export function listConfiguredSponsoredProviders(
  env: NodeJS.ProcessEnv = process.env,
): SponsoredCandidate[] {
  return SPONSORED_PROVIDER_ORDER.filter((c) => Boolean(env[c.envKey]?.trim()));
}

export function isSponsoredRateLimitError(error: unknown): boolean {
  if (error instanceof ProviderRateLimitError) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    /\b429\b/.test(msg) ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("quota") ||
    msg.includes("too many requests") ||
    msg.includes("capacity")
  );
}

export class SponsoredFailoverChatAdapter implements ChatAdapter {
  /** Updates after a successful complete() so metering sees the live provider. */
  provider = "sponsored";
  model = "promo-pool";

  private readonly adapters: Array<{
    id: SponsoredProviderId;
    model: string;
    adapter: HttpChatAdapter;
  }>;

  constructor(input?: {
    promptCachingEnabled?: boolean;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
  }) {
    const env = input?.env ?? process.env;
    const caching = input?.promptCachingEnabled ?? false;
    this.adapters = listConfiguredSponsoredProviders(env).map((c) => ({
      id: c.id,
      model: c.model,
      adapter: new HttpChatAdapter({
        provider: "openai-compatible",
        model: c.model,
        apiKey: env[c.envKey]!.trim(),
        baseUrl: c.baseUrl,
        promptCachingEnabled: caching,
        prices: c.prices,
        fetchImpl: input?.fetchImpl,
      }),
    }));
    if (this.adapters.length === 0) {
      throw new Error(
        "No sponsored provider API keys configured (MISTRAL_API_KEY / CEREBRAS_API_KEY / GROQ_API_KEY / COHERE_API_KEY).",
      );
    }
    this.provider = `sponsored:${this.adapters[0]!.id}`;
    this.model = this.adapters[0]!.model;
  }

  get configuredProviders(): SponsoredProviderId[] {
    return this.adapters.map((a) => a.id);
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    promptCachingEnabled?: boolean;
  }) {
    const errors: string[] = [];
    for (const entry of this.adapters) {
      try {
        const result = await entry.adapter.complete(input);
        this.provider = `sponsored:${entry.id}`;
        this.model = entry.model;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${entry.id}: ${message}`);
        if (!isSponsoredRateLimitError(error) && !(error instanceof ProviderRateLimitError)) {
          // Auth / hard failures: try next provider anyway (spare pool), but prefer
          // continuing only on rate-limit / quota. Non-rate-limit: still failover once
          // so a single bad key does not kill the promo path.
          if (!isRetryableSponsoredFailure(error)) {
            throw error;
          }
        }
      }
    }
    throw new Error(
      `All sponsored promo providers are unavailable or rate-limited. Tried: ${errors.join(" | ")}`,
    );
  }
}

function isRetryableSponsoredFailure(error: unknown): boolean {
  if (isSponsoredRateLimitError(error)) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  // Transient upstream / capacity
  return /\b(503|502|504|529)\b/.test(msg) || /overloaded|unavailable|timeout/i.test(msg);
}

export function tryCreateSponsoredFailoverAdapter(input?: {
  promptCachingEnabled?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}): SponsoredFailoverChatAdapter | null {
  if (listConfiguredSponsoredProviders(input?.env ?? process.env).length === 0) {
    return null;
  }
  return new SponsoredFailoverChatAdapter(input);
}
