import type { PoolClient } from "@neondatabase/serverless";
import { createKms, decryptSecret } from "@vantage/billing";
import {
  LOCAL_OPENAI_COMPAT_LABEL,
  pickByokModelForFeature,
  type ByokModelOption,
  type ByokModelProvider,
} from "./byok-model-routing";
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
  /** Feature tag for Automode (cad, coding, strategy, chat, …). */
  feature?: string;
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
  keyCiphertext: string | null;
  keyNonce: string | null;
  keyAuthTag: string | null;
  encryptedDek: string | null;
  kmsKeyId: string | null;
};

type OrgProviderRow = EncryptedRow & {
  id: string;
  kind: string;
  label: string;
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

type RoutingPrefs = {
  mode: "fixed" | "automode";
  fixedModelId: string | null;
  enabledModelIds: string[] | null;
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

/** Google Gemini via the public OpenAI-compatible Generative Language endpoint. */
const GOOGLE_OPENAI_COMPAT_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";
const GOOGLE_DEFAULT_MODEL = "gemini-2.0-flash";
const GOOGLE_DEFAULT_PRICES: PromptCachePrices = {
  inputPerMillionUsd: 0.1,
  outputPerMillionUsd: 0.4,
};

function normalizeProvider(kind: string): HttpChatAdapterConfig["provider"] | null {
  const value = kind.trim().toLowerCase();
  if (value === "openai" || value === "anthropic" || value === "openai-compatible") return value;
  if (value.includes("anthropic") || value.includes("claude")) return "anthropic";
  if (value.includes("openai") || value.includes("compatible") || value === "ollama" || value === "lm-studio") {
    return "openai-compatible";
  }
  return null;
}

function isGoogleByokProvider(kind: string): boolean {
  const value = kind.trim().toLowerCase();
  return value === "google" || value === "gemini" || value.includes("gemini");
}

function isLoopbackUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return /localhost|127\.0\.0\.1/i.test(value);
  }
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

function pricesFromOption(option: ByokModelOption): PromptCachePrices {
  return {
    inputPerMillionUsd: option.inputPerMillionUsd,
    outputPerMillionUsd: option.outputPerMillionUsd,
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
  if (
    !row.keyCiphertext ||
    !row.keyNonce ||
    !row.keyAuthTag ||
    !row.encryptedDek ||
    !row.kmsKeyId
  ) {
    return "";
  }
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
    throw new ChatProviderResolutionError(
      "Stored AI provider key could not be decrypted. Check KMS setup under Team → AI API keys.",
    );
  }
}

async function loadRoutingPrefs(client: PoolClient, orgId: string): Promise<RoutingPrefs> {
  try {
    const result = await client.query<{
      mode: string;
      fixedModelId: string | null;
      enabledModelIds: string[] | null;
    }>(
      `SELECT mode,
              fixed_model_id AS "fixedModelId",
              enabled_model_ids AS "enabledModelIds"
         FROM org_byok_routing_prefs
        WHERE org_id = $1::uuid`,
      [orgId],
    );
    const row = result.rows[0];
    if (!row) return { mode: "automode", fixedModelId: null, enabledModelIds: null };
    return {
      mode: row.mode === "fixed" ? "fixed" : "automode",
      fixedModelId: row.fixedModelId,
      enabledModelIds: row.enabledModelIds,
    };
  } catch {
    // Table may not exist yet before migration — degrade to automode defaults.
    return { mode: "automode", fixedModelId: null, enabledModelIds: null };
  }
}

function availableProvidersFrom(
  orgKeys: OrgKeyRow[],
  orgProviders: OrgProviderRow[],
): ByokModelProvider[] {
  const set = new Set<ByokModelProvider>();
  for (const row of orgKeys) {
    if (isGoogleByokProvider(row.provider)) set.add("google");
    else if (normalizeProvider(row.provider) === "openai") set.add("openai");
    else if (normalizeProvider(row.provider) === "anthropic") set.add("anthropic");
  }
  for (const row of orgProviders) {
    if (row.localRelay) continue;
    if (row.baseUrl || normalizeProvider(row.kind) === "openai-compatible") {
      set.add("openai-compatible");
    }
  }
  return [...set];
}

/**
 * Resolve a live HTTP chat adapter for an org (BYOK → custom → managed).
 * Honors fixed / Automode prefs when BYOK keys are present.
 * Never falls back to LocalDeterministicChatAdapter — callers get an honest error
 * when no usable key exists. Metering still goes through meteredAI in the orchestrator.
 */
export async function resolveOrgChatAdapter(
  client: PoolClient,
  input: ResolveOrgChatAdapterInput,
): Promise<ChatAdapter> {
  const prefs = await loadRoutingPrefs(client, input.orgId);

  const orgProviders = await client.query<OrgProviderRow>(
    `SELECT id, kind, label, base_url AS "baseUrl", local_relay AS "localRelay",
            model_mappings AS "modelMappings",
            key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
            key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
            kms_key_id AS "kmsKeyId"
     FROM org_provider_configs
     WHERE org_id = $1 AND enabled = true AND disabled_at IS NULL
     ORDER BY
       CASE WHEN label = $2 THEN 0 ELSE 1 END,
       created_at DESC`,
    [input.orgId, LOCAL_OPENAI_COMPAT_LABEL],
  );

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

  const available = availableProvidersFrom(orgKeys.rows, orgProviders.rows);
  const chosen = pickByokModelForFeature({
    feature: input.feature,
    mode: prefs.mode,
    fixedModelId: prefs.fixedModelId,
    enabledModelIds: prefs.enabledModelIds,
    availableProviders: available.filter((p) => p !== "openai-compatible") as ByokModelProvider[],
  });

  // Prefer explicit OpenAI-compatible / local connector when configured.
  const localOrCompat = orgProviders.rows.find(
    (row) =>
      !row.localRelay &&
      (row.label === LOCAL_OPENAI_COMPAT_LABEL ||
        normalizeProvider(row.kind) === "openai-compatible" ||
        Boolean(row.baseUrl)),
  );
  if (localOrCompat?.baseUrl) {
    // When Automode/fixed picks a first-party model and a cloud key exists, prefer that
    // unless the only available path is the local connector.
    const hasCloudKey = orgKeys.rows.some(
      (row) =>
        isGoogleByokProvider(row.provider) ||
        normalizeProvider(row.provider) === "openai" ||
        normalizeProvider(row.provider) === "anthropic",
    );
    const forceLocal =
      !hasCloudKey ||
      available.length === 0 ||
      (prefs.mode === "fixed" && prefs.fixedModelId?.startsWith("openai-compatible:"));
    if (forceLocal || !chosen) {
      const apiKey = await decryptRow(localOrCompat, input.decrypt);
      const model = pickMappedModel(
        localOrCompat.modelMappings,
        chosen?.provider === "openai" || chosen?.provider === "openai-compatible"
          ? chosen.modelId
          : DEFAULT_MODELS["openai-compatible"],
      );
      const prices =
        chosen && (chosen.provider === "openai" || chosen.provider === "openai-compatible")
          ? pricesFromOption(chosen)
          : DEFAULT_PRICES["openai-compatible"];
      if (isLoopbackUrl(localOrCompat.baseUrl) && process.env.VERCEL) {
        // Soft warning path — still attempt; fetch will fail honestly if unreachable.
      }
      return new HttpChatAdapter({
        provider: "openai-compatible",
        model,
        apiKey,
        baseUrl: localOrCompat.baseUrl,
        promptCachingEnabled: input.promptCachingEnabled,
        prices,
        fetchImpl: input.fetchImpl,
      });
    }
  }

  // First-party BYOK keys with Automode / fixed selection.
  if (chosen) {
    if (chosen.provider === "google") {
      const row = orgKeys.rows.find((r) => isGoogleByokProvider(r.provider));
      if (row) {
        const apiKey = await decryptRow(row, input.decrypt);
        return new HttpChatAdapter({
          provider: "openai-compatible",
          model: chosen.modelId,
          apiKey,
          baseUrl: GOOGLE_OPENAI_COMPAT_BASE,
          promptCachingEnabled: input.promptCachingEnabled,
          prices: pricesFromOption(chosen),
          fetchImpl: input.fetchImpl,
        });
      }
    }
    if (chosen.provider === "openai" || chosen.provider === "anthropic") {
      const row = orgKeys.rows.find((r) => normalizeProvider(r.provider) === chosen.provider);
      if (row) {
        const apiKey = await decryptRow(row, input.decrypt);
        return new HttpChatAdapter({
          provider: chosen.provider,
          model: chosen.modelId,
          apiKey,
          promptCachingEnabled: input.promptCachingEnabled,
          prices: pricesFromOption(chosen),
          fetchImpl: input.fetchImpl,
        });
      }
    }
  }

  // Legacy: any enabled HTTPS custom provider (Team Admin).
  const hosted = orgProviders.rows.find(
    (row) => !row.localRelay && row.baseUrl && row.keyCiphertext,
  );
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

  // Fallback: first usable org_llm_keys row (pre-Automode behavior).
  for (const row of orgKeys.rows) {
    if (isGoogleByokProvider(row.provider)) {
      const apiKey = await decryptRow(row, input.decrypt);
      const prices = await catalogPrices(client, "google", GOOGLE_DEFAULT_MODEL, GOOGLE_DEFAULT_PRICES);
      return new HttpChatAdapter({
        provider: "openai-compatible",
        model: GOOGLE_DEFAULT_MODEL,
        apiKey,
        baseUrl: GOOGLE_OPENAI_COMPAT_BASE,
        promptCachingEnabled: input.promptCachingEnabled,
        prices,
        fetchImpl: input.fetchImpl,
      });
    }
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

  // Keyless local connector last chance.
  if (localOrCompat?.baseUrl) {
    const apiKey = await decryptRow(localOrCompat, input.decrypt);
    const model = pickMappedModel(localOrCompat.modelMappings, DEFAULT_MODELS["openai-compatible"]);
    return new HttpChatAdapter({
      provider: "openai-compatible",
      model,
      apiKey,
      baseUrl: localOrCompat.baseUrl,
      promptCachingEnabled: input.promptCachingEnabled,
      prices: DEFAULT_PRICES["openai-compatible"],
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
      "Configured providers use the local desktop relay, which cannot serve hosted chat. Add an OpenAI-compatible base URL under Team → AI API keys, or an HTTPS OpenAI/Anthropic key.",
    );
  }

  if (tier === "free") {
    throw new ChatProviderResolutionError(
      "No AI provider key is configured for this organization. Free workspaces need your own OpenAI, Anthropic, or Google key under Team → AI API keys (or a local OpenAI-compatible base URL for Ollama / LM Studio).",
    );
  }

  throw new ChatProviderResolutionError(
    "No AI provider key is available. Add OpenAI / Anthropic / Google under Team → AI API keys, configure a local OpenAI-compatible connector, or ask a platform admin to add a managed hosted key.",
  );
}
