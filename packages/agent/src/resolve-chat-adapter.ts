import type { PoolClient } from "@neondatabase/serverless";
import { createKms, decryptSecret } from "@vantage/billing";
import type { ChatAdapter } from "./index";
import { HttpChatAdapter, type HttpChatAdapterConfig } from "./http-chat-adapter";
import type { PromptCachePrices } from "./prompt-caching";

export class ChatProviderResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProviderResolutionError";
  }
}

export type ResolveOrgChatAdapterInput = {
  orgId: string;
  promptCachingEnabled: boolean;
  /** Injected for tests. Defaults to billing KMS decrypt. */
  decrypt?: (parts: {
    ciphertext: string;
    nonce: string;
    authTag: string;
    encryptedDek: string;
    kmsKeyId: string;
  }) => Promise<string>;
  fetchImpl?: typeof fetch;
};

type EncryptedRow = {
  keyCiphertext: string;
  keyNonce: string;
  keyAuthTag: string;
  encryptedDek: string;
  kmsKeyId: string;
};

type OrgProviderRow = EncryptedRow & {
  id: string;
  kind: string;
  baseUrl: string | null;
  localRelay: boolean;
  modelMappings: Record<string, string> | null;
};

type OrgKeyRow = EncryptedRow & {
  id: string;
  provider: string;
};

type ManagedRow = EncryptedRow & {
  provider: string;
  model: string;
  keyId: string;
  inputPrice: string | null;
  outputPrice: string | null;
  cacheReadPrice: string | null;
  cacheWritePrice: string | null;
};

const DEFAULT_MODELS: Record<"openai" | "anthropic" | "openai-compatible", string> = {
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-20250514",
  "openai-compatible": "gpt-4.1-mini",
};

const DEFAULT_PRICES: Record<"openai" | "anthropic" | "openai-compatible", PromptCachePrices> = {
  openai: { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
  anthropic: { inputPerMillionUsd: 3, outputPerMillionUsd: 15 },
  "openai-compatible": { inputPerMillionUsd: 0.4, outputPerMillionUsd: 1.6 },
};

function normalizeProvider(kind: string): HttpChatAdapterConfig["provider"] | null {
  const value = kind.trim().toLowerCase();
  if (value === "openai" || value === "anthropic" || value === "openai-compatible") return value;
  if (value.includes("anthropic") || value.includes("claude")) return "anthropic";
  if (value.includes("openai") || value.includes("compatible")) return "openai-compatible";
  return null;
}

function pickMappedModel(mappings: Record<string, string> | null | undefined, fallback: string) {
  if (!mappings || typeof mappings !== "object") return fallback;
  if (typeof mappings.default === "string" && mappings.default.trim()) return mappings.default.trim();
  if (typeof mappings.chat === "string" && mappings.chat.trim()) return mappings.chat.trim();
  const first = Object.values(mappings).find((value) => typeof value === "string" && value.trim());
  return first?.trim() || fallback;
}

function pricesFromNumbers(input: {
  input?: string | number | null;
  output?: string | number | null;
  cacheRead?: string | number | null;
  cacheWrite?: string | number | null;
  fallback: PromptCachePrices;
}): PromptCachePrices {
  const inputPrice = Number(input.input);
  const outputPrice = Number(input.output);
  return {
    inputPerMillionUsd: Number.isFinite(inputPrice) ? inputPrice : input.fallback.inputPerMillionUsd,
    outputPerMillionUsd: Number.isFinite(outputPrice) ? outputPrice : input.fallback.outputPerMillionUsd,
    cacheReadPerMillionUsd:
      input.cacheRead == null || input.cacheRead === ""
        ? null
        : Number.isFinite(Number(input.cacheRead))
          ? Number(input.cacheRead)
          : null,
    cacheWritePerMillionUsd:
      input.cacheWrite == null || input.cacheWrite === ""
        ? null
        : Number.isFinite(Number(input.cacheWrite))
          ? Number(input.cacheWrite)
          : null,
  };
}

async function catalogPrices(
  client: PoolClient,
  provider: string,
  model: string,
  fallback: PromptCachePrices,
): Promise<PromptCachePrices> {
  const result = await client.query<{
    inputPrice: string;
    outputPrice: string;
    cacheReadPrice: string | null;
    cacheWritePrice: string | null;
  }>(
    `SELECT input_price_per_million_usd::text AS "inputPrice",
            output_price_per_million_usd::text AS "outputPrice",
            cache_read_price_per_million_usd::text AS "cacheReadPrice",
            cache_write_price_per_million_usd::text AS "cacheWritePrice"
     FROM model_catalog
     WHERE enabled = true
       AND provider = $1
       AND (provider_model_id = $2 OR display_name = $2)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [provider, model],
  );
  const row = result.rows[0];
  if (!row) return fallback;
  return pricesFromNumbers({
    input: row.inputPrice,
    output: row.outputPrice,
    cacheRead: row.cacheReadPrice,
    cacheWrite: row.cacheWritePrice,
    fallback,
  });
}

async function decryptRow(
  row: EncryptedRow,
  decrypt: ResolveOrgChatAdapterInput["decrypt"],
): Promise<string> {
  try {
    if (decrypt) {
      return await decrypt({
        ciphertext: row.keyCiphertext,
        nonce: row.keyNonce,
        authTag: row.keyAuthTag,
        encryptedDek: row.encryptedDek,
        kmsKeyId: row.kmsKeyId,
      });
    }
    return await decryptSecret(
      {
        ciphertext: row.keyCiphertext,
        nonce: row.keyNonce,
        authTag: row.keyAuthTag,
        encryptedDek: row.encryptedDek,
        kmsKeyId: row.kmsKeyId,
      },
      createKms(),
    );
  } catch {
    throw new ChatProviderResolutionError("Stored AI provider key could not be decrypted.");
  }
}

/**
 * Resolve a live HTTP chat adapter for an org (BYOK → custom → managed).
 * Never falls back to LocalDeterministicChatAdapter — callers get an honest error
 * when no usable key exists. Metering still goes through meteredAI in the orchestrator.
 */
export async function resolveOrgChatAdapter(
  client: PoolClient,
  input: ResolveOrgChatAdapterInput,
): Promise<ChatAdapter> {
  const orgProviders = await client.query<OrgProviderRow>(
    `SELECT id, kind, base_url AS "baseUrl", local_relay AS "localRelay",
            model_mappings AS "modelMappings",
            key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
            key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
            kms_key_id AS "kmsKeyId"
     FROM org_provider_configs
     WHERE org_id = $1 AND enabled = true AND disabled_at IS NULL
       AND key_ciphertext IS NOT NULL AND key_nonce IS NOT NULL
       AND key_auth_tag IS NOT NULL AND encrypted_dek IS NOT NULL AND kms_key_id IS NOT NULL
     ORDER BY created_at DESC`,
    [input.orgId],
  );

  const hosted = orgProviders.rows.find((row) => !row.localRelay);
  if (hosted) {
    const provider = normalizeProvider(hosted.kind) ?? (hosted.baseUrl ? "openai-compatible" : null);
    if (!provider) {
      throw new ChatProviderResolutionError(
        `Custom provider "${hosted.kind}" is not a supported OpenAI/Anthropic HTTP adapter.`,
      );
    }
    const model = pickMappedModel(hosted.modelMappings, DEFAULT_MODELS[provider]);
    const apiKey = await decryptRow(hosted, input.decrypt);
    const prices = await catalogPrices(
      client,
      provider === "openai-compatible" ? "openai" : provider,
      model,
      DEFAULT_PRICES[provider],
    );
    return new HttpChatAdapter({
      provider,
      model,
      apiKey,
      baseUrl: hosted.baseUrl ?? undefined,
      promptCachingEnabled: input.promptCachingEnabled,
      prices,
      fetchImpl: input.fetchImpl,
    });
  }

  const orgKeys = await client.query<OrgKeyRow>(
    `SELECT id, provider,
            key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
            key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
            kms_key_id AS "kmsKeyId"
     FROM org_llm_keys
     WHERE org_id = $1
     ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
    [input.orgId],
  );
  for (const row of orgKeys.rows) {
    // Bare org_llm_keys have no base URL — only first-party OpenAI/Anthropic work.
    const provider = normalizeProvider(row.provider);
    if (provider !== "openai" && provider !== "anthropic") continue;
    const model = DEFAULT_MODELS[provider];
    const apiKey = await decryptRow(row, input.decrypt);
    const prices = await catalogPrices(client, provider, model, DEFAULT_PRICES[provider]);
    return new HttpChatAdapter({
      provider,
      model,
      apiKey,
      promptCachingEnabled: input.promptCachingEnabled,
      prices,
      fetchImpl: input.fetchImpl,
    });
  }

  const billing = await client.query<{ tier: string }>(
    `SELECT tier FROM org_billing WHERE org_id = $1`,
    [input.orgId],
  );
  const tier = billing.rows[0]?.tier ?? "free";

  if (tier !== "free") {
    const managed = await client.query<ManagedRow>(
      `SELECT provider, model,
              key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
              key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
              kms_key_id AS "kmsKeyId", key_id AS "keyId",
              input_price_per_million_usd::text AS "inputPrice",
              output_price_per_million_usd::text AS "outputPrice",
              cache_read_price_per_million_usd::text AS "cacheReadPrice",
              cache_write_price_per_million_usd::text AS "cacheWritePrice"
       FROM peek_managed_chat_provider($1::uuid)`,
      [input.orgId],
    );
    const row = managed.rows[0];
    if (row) {
      const provider = normalizeProvider(row.provider);
      if (provider === "openai" || provider === "anthropic") {
        const apiKey = await decryptRow(row, input.decrypt);
        return new HttpChatAdapter({
          provider,
          model: row.model || DEFAULT_MODELS[provider],
          apiKey,
          promptCachingEnabled: input.promptCachingEnabled,
          prices: pricesFromNumbers({
            input: row.inputPrice,
            output: row.outputPrice,
            cacheRead: row.cacheReadPrice,
            cacheWrite: row.cacheWritePrice,
            fallback: DEFAULT_PRICES[provider],
          }),
          fetchImpl: input.fetchImpl,
        });
      }
    }
  }

  if (orgProviders.rows.some((row) => row.localRelay)) {
    throw new ChatProviderResolutionError(
      "Configured providers use the local desktop relay, which cannot serve hosted chat. Add an HTTPS OpenAI or Anthropic API key under Team Admin.",
    );
  }

  if (tier === "free") {
    throw new ChatProviderResolutionError(
      "No AI provider key is configured for this organization. Free workspaces require a BYOK or custom OpenAI/Anthropic provider under Team Admin.",
    );
  }

  throw new ChatProviderResolutionError(
    "No AI provider key is available. Configure a team BYOK/custom OpenAI or Anthropic provider under Team Admin, or ask a platform admin to add a managed provider key.",
  );
}
