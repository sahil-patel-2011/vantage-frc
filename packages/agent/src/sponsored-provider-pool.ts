import type { ChatAdapter, ContextItem } from "./index";
import { HttpChatAdapter, ProviderRateLimitError } from "./http-chat-adapter";

/**
 * Platform-sponsored promotional AI pool (env keys only — never commit values).
 * Env: MISTRAL_API_KEY, GROQ_API_KEY, COHERE_API_KEY, CEREBRAS_API_KEY
 *
 * Selection: weighted round-robin across configured keys (not fixed Mistral-first).
 * Default weights — Mistral 2, Groq/Cohere/Cerebras 1 — so Mistral gets ~2× the
 * first-attempt share when all four are present, without draining it alone.
 * On 429/402/503 (and similar), try remaining providers in that request's order;
 * never retry the same failed provider in the same attempt chain.
 *
 * Health: a 402/429/503 marks the provider degraded for a short TTL so it is
 * not chosen as primary (still available last-resort). Cerebras chat often 402s.
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

/** Short TTL so Hobby cold starts / quota flaps do not permanently drop a key. */
export const SPONSORED_DEGRADED_TTL_MS = 5 * 60 * 1000;

/**
 * Catalog order is stable for config listing only. Live attempt order comes from
 * {@link orderSponsoredProvidersWeightedRoundRobin}.
 * Model ids pinned to smoke-tested free/promo endpoints.
 */
export const SPONSORED_PROVIDER_ORDER: SponsoredCandidate[] = [
  {
    id: "mistral",
    envKey: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.3 },
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
  {
    id: "cerebras",
    envKey: "CEREBRAS_API_KEY",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "llama3.1-8b",
    prices: { inputPerMillionUsd: 0.1, outputPerMillionUsd: 0.1 },
  },
];

/** First-attempt share: Mistral twice the others when all keys are present. */
export const SPONSORED_PROVIDER_WEIGHTS: Record<SponsoredProviderId, number> = {
  mistral: 2,
  groq: 1,
  cohere: 1,
  cerebras: 1,
};

/** Process-local RR cursor (fine for Hobby serverless; resets on cold start). */
let sponsoredRotationCursor = 0;

/** Process-local degraded-until map (ms epoch). */
const sponsoredDegradedUntil = new Map<SponsoredProviderId, number>();

/** Test helper — reset the in-memory weighted RR cursor. */
export function resetSponsoredRotationCursor(value = 0): void {
  sponsoredRotationCursor = value;
}

export function peekSponsoredRotationCursor(): number {
  return sponsoredRotationCursor;
}

/** Test / ops helper — clear or seed degraded health. */
export function resetSponsoredProviderHealth(): void {
  sponsoredDegradedUntil.clear();
}

export function markSponsoredProviderDegraded(
  id: SponsoredProviderId,
  nowMs: number = Date.now(),
  ttlMs: number = SPONSORED_DEGRADED_TTL_MS,
): void {
  sponsoredDegradedUntil.set(id, nowMs + ttlMs);
}

export function isSponsoredProviderDegraded(
  id: SponsoredProviderId,
  nowMs: number = Date.now(),
): boolean {
  const until = sponsoredDegradedUntil.get(id);
  if (until === undefined) return false;
  if (until <= nowMs) {
    sponsoredDegradedUntil.delete(id);
    return false;
  }
  return true;
}

/** Masked Soft-UI / admin snapshot — never includes API key values. */
export function getSponsoredPoolStatus(env: NodeJS.ProcessEnv = process.env): {
  configured: SponsoredProviderId[];
  models: Record<string, string>;
  weights: Record<SponsoredProviderId, number>;
  balancing: "weighted_round_robin";
  degraded: SponsoredProviderId[];
} {
  const configured = listConfiguredSponsoredProviders(env);
  const degraded = configured
    .map((c) => c.id)
    .filter((id) => isSponsoredProviderDegraded(id));
  const models: Record<string, string> = {};
  for (const c of configured) models[c.id] = c.model;
  return {
    configured: configured.map((c) => c.id),
    models,
    weights: { ...SPONSORED_PROVIDER_WEIGHTS },
    balancing: "weighted_round_robin",
    degraded,
  };
}

/**
 * Build a unique attempt order for one request using weighted round-robin.
 * Walks an expanded weight wheel from `cursor % wheel.length`, then de-dupes
 * so each configured provider appears once (primary first, then failover).
 * Degraded providers are moved to the end (last-resort) without dropping them.
 */
export function orderSponsoredProvidersWeightedRoundRobin(
  configured: SponsoredCandidate[],
  cursor: number = sponsoredRotationCursor++,
  nowMs: number = Date.now(),
): SponsoredCandidate[] {
  if (configured.length <= 1) return [...configured];

  const byId = new Map(configured.map((c) => [c.id, c]));
  const wheel: SponsoredProviderId[] = [];
  for (const c of configured) {
    const weight = Math.max(1, SPONSORED_PROVIDER_WEIGHTS[c.id] ?? 1);
    for (let i = 0; i < weight; i++) {
      wheel.push(c.id);
    }
  }

  const start = ((cursor % wheel.length) + wheel.length) % wheel.length;
  const seen = new Set<SponsoredProviderId>();
  const healthy: SponsoredCandidate[] = [];
  const degraded: SponsoredCandidate[] = [];
  for (let i = 0; i < wheel.length; i++) {
    const id = wheel[(start + i) % wheel.length]!;
    if (seen.has(id)) continue;
    seen.add(id);
    const candidate = byId.get(id);
    if (!candidate) continue;
    if (isSponsoredProviderDegraded(id, nowMs)) degraded.push(candidate);
    else healthy.push(candidate);
  }
  return [...healthy, ...degraded];
}

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
    /\b402\b/.test(msg) ||
    /\b429\b/.test(msg) ||
    msg.includes("rate limit") ||
    msg.includes("rate_limit") ||
    msg.includes("quota") ||
    msg.includes("payment") ||
    msg.includes("insufficient") ||
    msg.includes("too many requests") ||
    msg.includes("capacity")
  );
}

export class SponsoredFailoverChatAdapter implements ChatAdapter {
  /** Updates after a successful complete() so metering sees the live provider. */
  provider = "sponsored";
  model = "promo-pool";

  private readonly adapters: Map<
    SponsoredProviderId,
    { id: SponsoredProviderId; model: string; adapter: HttpChatAdapter }
  >;
  private readonly catalog: SponsoredCandidate[];

  constructor(input?: {
    promptCachingEnabled?: boolean;
    fetchImpl?: typeof fetch;
    env?: NodeJS.ProcessEnv;
    capability?: string;
    timeoutMs?: number;
  }) {
    const env = input?.env ?? process.env;
    const caching = input?.promptCachingEnabled ?? true;
    this.catalog = listConfiguredSponsoredProviders(env);
    this.adapters = new Map(
      this.catalog.map((c) => [
        c.id,
        {
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
            providerLabel: `sponsored:${c.id}`,
            capability: input?.capability ?? "chat",
            timeoutMs: input?.timeoutMs,
          }),
        },
      ]),
    );
    if (this.catalog.length === 0) {
      throw new Error(
        "No sponsored provider API keys configured (MISTRAL_API_KEY / GROQ_API_KEY / COHERE_API_KEY / CEREBRAS_API_KEY).",
      );
    }
    this.provider = `sponsored:${this.catalog[0]!.id}`;
    this.model = this.catalog[0]!.model;
  }

  get configuredProviders(): SponsoredProviderId[] {
    return this.catalog.map((a) => a.id);
  }

  async complete(input: {
    message: string;
    context: ContextItem[];
    promptCachingEnabled?: boolean;
  }) {
    // Same message + context for every failover attempt — never strip system/context.
    const attemptOrder = orderSponsoredProvidersWeightedRoundRobin(this.catalog);
    const errors: string[] = [];
    const tried = new Set<SponsoredProviderId>();

    for (const candidate of attemptOrder) {
      if (tried.has(candidate.id)) continue;
      tried.add(candidate.id);
      const entry = this.adapters.get(candidate.id);
      if (!entry) continue;

      try {
        const result = await entry.adapter.complete(input);
        this.provider = `sponsored:${entry.id}`;
        this.model = entry.model;
        if (process.env.VANTAGE_DEBUG_SPONSORED === "1") {
          console.info(
            `[sponsored-pool] served by ${entry.id} model=${entry.model} (tried=${[...tried].join(",")})`,
          );
        }
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${entry.id}/${entry.model}: ${message}`);
        if (
          error instanceof ProviderRateLimitError ||
          isSponsoredRateLimitError(error)
        ) {
          markSponsoredProviderDegraded(entry.id);
        }
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
  // Transient upstream / capacity / payment-quota (402) when not already typed
  return (
    /\b(402|502|503|504|529)\b/.test(msg) ||
    /overloaded|unavailable|timeout/i.test(msg)
  );
}

export function tryCreateSponsoredFailoverAdapter(input?: {
  promptCachingEnabled?: boolean;
  fetchImpl?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  capability?: string;
  timeoutMs?: number;
}): SponsoredFailoverChatAdapter | null {
  if (listConfiguredSponsoredProviders(input?.env ?? process.env).length === 0) {
    return null;
  }
  return new SponsoredFailoverChatAdapter(input);
}
