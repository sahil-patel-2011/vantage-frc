import type { PoolClient } from "@neondatabase/serverless";
import {
  createKms,
  decryptSecret,
  maybeNotifySponsoredPromoExpired,
  resolveSponsoredPromoForOrg,
  sponsoredPromoExpiredMessage,
} from "@vantage/billing";
import {
  BYOK_MODEL_OPTIONS,
  LOCAL_OPENAI_COMPAT_LABEL,
  pickByokModelForFeature,
  type ByokModelOption,
  type ByokModelProvider,
} from "./byok-model-routing";
import {
  applyPolicyToRoutingPrefs,
  normalizeOrgModelPolicy,
  type OrgModelPolicy,
} from "./model-policy";
import type { ChatAdapter } from "./index";
import { HttpChatAdapter, type HttpChatAdapterConfig } from "./http-chat-adapter";
import type { PromptCachePrices } from "./prompt-caching";
import {
  OPENROUTER_BASE_URL,
  openRouterFreeModel,
  openRouterRequestHeaders,
  tryCreateHostedAnthropicAdapter,
  tryCreateOpenRouterFreeAdapter,
} from "./hosted-platform-keys";
import { orgHasAiAccessGrant } from "./org-ai-access";
import { tryCreatePlatformRelayAdapter } from "./relay-failover-adapter";
import { tryCreateSponsoredFailoverAdapter } from "./sponsored-provider-pool";
import { isLocalOrLanOrigin } from "./model-tier";
import {
  bridgeHeavyCliTimeoutMs,
  bridgeHeavyPollBudgetMs,
  SubscriptionBridgeChatAdapter,
  type BridgeDegradedReason,
  type SubscriptionBridgeTransport,
} from "./subscription-bridge-adapter";
import { classifyTaskDifficulty, consultingAllowed, type AutoRole } from "./auto-mode";

export class ChatProviderResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProviderResolutionError";
  }
}

/** Where the resolved key/endpoint came from — surfaced so callers can say what answered. */
export type ResolvedModelSource =
  | "org-key"
  | "member-key"
  | "hosted"
  | "sponsored"
  | "local-connector"
  | "local-fallback"
  | "subscription-bridge"
  /** Platform-owned free relay, opened for this org by a time-boxed admin grant. */
  | "platform-relay";

/**
 * Provenance of a resolved chat adapter. Additive metadata alongside the
 * adapter — safe to serialize to clients: origin only, never the full base URL
 * path and never key material.
 */
export type ResolvedModelProvenance = {
  provider: string;
  modelId: string;
  /** URL origin only (e.g. "http://127.0.0.1:11434"), null for provider defaults without a custom base. */
  baseUrlOrigin: string | null;
  source: ResolvedModelSource;
};

export type ResolvedOrgChatAdapter = {
  adapter: ChatAdapter;
  provenance: ResolvedModelProvenance;
  /**
   * Set when the org has a subscription bridge that could not serve this turn at
   * resolution time ("bridge-offline"). Execution-time fall-through reasons
   * ("bridge-timeout" / "bridge-rate-limited") live on
   * SubscriptionBridgeChatAdapter.lastDegraded after complete().
   */
  degraded?: BridgeDegradedReason;
};

/**
 * Interactive chat-class features that route through the subscription bridge under the
 * DEFAULT device coverage ('chat'). Long/batch features (dreams, bugbot scans, season
 * reports) don't default to a paired member's personal subscription — they run for
 * minutes and burn the plan's usage window. The subscriber can opt in to exactly that
 * by setting the device's coverage to 'everything' (Team → Subscription bridge), which
 * routes EVERY AI feature platform-wide through their plan while the device is online.
 */
export const BRIDGE_CHAT_FEATURES: ReadonlySet<string> = new Set([
  "chat",
  "writer",
  "troubleshoot-coach",
]);

/** A bridge device counts as online while its last heartbeat is under 3 minutes old. */
export const BRIDGE_ONLINE_WINDOW_MS = 3 * 60_000;

function originOnly(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Build provenance from any resolved adapter + the source the resolver knows. */
export function chatAdapterProvenance(
  adapter: ChatAdapter,
  source: ResolvedModelSource,
): ResolvedModelProvenance {
  const baseUrl = adapter instanceof HttpChatAdapter ? adapter.baseUrl : null;
  return {
    provider: adapter.provider,
    modelId: adapter.model,
    baseUrlOrigin: originOnly(baseUrl),
    source,
  };
}

/** Provenance for the deterministic offline fallback (LocalDeterministicChatAdapter). */
export function localFallbackProvenance(): ResolvedModelProvenance {
  return {
    provider: "local",
    modelId: "vantage-local-chat-v1",
    baseUrlOrigin: null,
    source: "local-fallback",
  };
}

/** org_provider_configs rows: localhost/LAN base = local connector, remote HTTPS = org-configured key. */
function providerConfigSource(baseUrl: string | null | undefined): ResolvedModelSource {
  return isLocalOrLanOrigin(originOnly(baseUrl)) ? "local-connector" : "org-key";
}

export type ResolveOrgChatAdapterInput = {
  orgId: string;
  /**
   * When set, that member's keys overlay the team's for the same provider
   * (personal OpenAI/Anthropic, including an OpenAI-compatible base URL).
   * Omit in tests and worker jobs that should use org keys only.
   */
  userId?: string;
  promptCachingEnabled: boolean;
  /** Feature tag for Automode (cad, coding, strategy, chat, …). */
  feature?: string;
  /** Current user ask, used only to select Automode difficulty. Never persisted here. */
  taskText?: string;
  /** Execute is the normal production role; think is for an explicit consultant pass. */
  autoRole?: AutoRole;
  consultEnabled?: boolean;
  lockRun?: boolean;
  /**
   * Skip org BYOK / local connectors and use hosted Vantage keys only.
   * Used by Bugbot Ultra (flat-fee SKU). Honest error when no hosted key exists.
   */
  preferPlatform?: boolean;
  /**
   * When provided (apps/web/lib/ai-bridge/transport.ts), an ONLINE paired subscription
   * bridge (heartbeat < 3 min, prefer_when_online) is tried FIRST for chat-class
   * features; on bridge failure the adapter itself falls through to the normal key
   * chain resolved below. Omitted (tests, workers, batch features) → unchanged behavior.
   */
  bridgeTransport?: SubscriptionBridgeTransport;
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

export type OrgKeyRow = EncryptedRow & {
  id: string;
  provider: string;
  baseUrl?: string | null;
  model?: string | null;
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
  // Anthropic's published cache rates: reads 0.1x input, writes 1.25x — without
  // them a plain BYOK key meters cached turns at full input price (over-report).
  anthropic: {
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
    cacheReadPerMillionUsd: 0.3,
    cacheWritePerMillionUsd: 3.75,
  },
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

function isOpenRouterByokProvider(kind: string): boolean {
  return kind.trim().toLowerCase() === "openrouter";
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

export async function decryptRow(
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

type RawPrefsJson = {
  mode?: string | null;
  fixed_model_id?: string | null;
  enabled_model_ids?: string[] | null;
} | null;

type RawPolicyJson = { mode?: string | null; allowed_model_ids?: string[] | null } | null;

/**
 * Load routing prefs plus the org model SELECTION policy (org_model_policy —
 * which models members may pick; distinct from billing's spend limits in
 * org_api_model_limits) in a single round trip. Falls back to the legacy
 * prefs-only query with the allow-everything default policy when the
 * org_model_policy table does not exist yet (pre-0443 deploys).
 */
async function loadRoutingPrefsAndPolicy(
  client: PoolClient,
  orgId: string,
): Promise<{ prefs: RoutingPrefs; policy: OrgModelPolicy }> {
  try {
    const result = await client.query<{ prefs: RawPrefsJson; policy: RawPolicyJson }>(
      `SELECT
         (SELECT to_jsonb(p) FROM org_byok_routing_prefs p WHERE p.org_id = $1::uuid) AS prefs,
         (SELECT to_jsonb(mp) FROM org_model_policy mp WHERE mp.org_id = $1::uuid) AS policy`,
      [orgId],
    );
    const row = result.rows[0];
    const prefsRaw = row?.prefs ?? null;
    const policyRaw = row?.policy ?? null;
    return {
      prefs: prefsRaw
        ? {
            mode: prefsRaw.mode === "fixed" ? "fixed" : "automode",
            fixedModelId: prefsRaw.fixed_model_id ?? null,
            enabledModelIds: prefsRaw.enabled_model_ids ?? null,
          }
        : { mode: "automode", fixedModelId: null, enabledModelIds: null },
      policy: normalizeOrgModelPolicy(
        policyRaw
          ? { mode: policyRaw.mode, allowedModelIds: policyRaw.allowed_model_ids ?? null }
          : null,
      ),
    };
  } catch {
    // org_model_policy may not exist yet — legacy prefs-only load, everything permitted.
    return {
      prefs: await loadRoutingPrefs(client, orgId),
      policy: normalizeOrgModelPolicy(null),
    };
  }
}

export async function loadOrgLlmKeys(client: PoolClient, orgId: string): Promise<OrgKeyRow[]> {
  try {
    const result = await client.query<OrgKeyRow>(
      `SELECT id, provider,
              base_url AS "baseUrl",
              model,
              key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
              key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
              kms_key_id AS "kmsKeyId"
       FROM org_llm_keys
       WHERE org_id = $1
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
      [orgId],
    );
    return result.rows;
  } catch {
    const result = await client.query<OrgKeyRow>(
      `SELECT id, provider,
              key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
              key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
              kms_key_id AS "kmsKeyId"
       FROM org_llm_keys
       WHERE org_id = $1
       ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
      [orgId],
    );
    return result.rows;
  }
}

export async function loadMemberLlmKeys(
  client: PoolClient,
  orgId: string,
  userId: string,
): Promise<OrgKeyRow[]> {
  try {
    const result = await client.query<OrgKeyRow>(
      `SELECT id, provider,
              base_url AS "baseUrl",
              model,
              key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
              key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
              kms_key_id AS "kmsKeyId"
         FROM member_llm_keys
        WHERE org_id = $1::uuid AND user_id = $2::uuid
        ORDER BY last_used_at DESC NULLS LAST, created_at DESC`,
      [orgId, userId],
    );
    return result.rows;
  } catch {
    // Table may not exist yet before migration.
    return [];
  }
}

function overlayMemberKeys(orgKeys: OrgKeyRow[], memberKeys: OrgKeyRow[]): OrgKeyRow[] {
  if (!memberKeys.length) return orgKeys;
  const personal = new Set(memberKeys.map((row) => row.provider.trim().toLowerCase()));
  return [
    ...memberKeys,
    ...orgKeys.filter((row) => !personal.has(row.provider.trim().toLowerCase())),
  ];
}

function httpAdapterFromLlmKey(
  row: OrgKeyRow,
  input: ResolveOrgChatAdapterInput,
  apiKey: string,
  model: string,
  prices: PromptCachePrices,
): HttpChatAdapter {
  const baseUrl = row.baseUrl?.trim() || undefined;
  const normalized = normalizeProvider(row.provider);
  if (normalized === "openai" && baseUrl) {
    return new HttpChatAdapter({
      provider: "openai-compatible",
      model: row.model?.trim() || model,
      apiKey,
      baseUrl,
      promptCachingEnabled: input.promptCachingEnabled,
      prices,
      fetchImpl: input.fetchImpl,
    });
  }
  const provider = normalized === "anthropic" || normalized === "openai" ? normalized : "openai";
  return new HttpChatAdapter({
    provider,
    model: row.model?.trim() || model,
    apiKey,
    baseUrl,
    promptCachingEnabled: input.promptCachingEnabled,
    prices,
    fetchImpl: input.fetchImpl,
  });
}

function availableProvidersFrom(
  orgKeys: OrgKeyRow[],
  orgProviders: OrgProviderRow[],
): ByokModelProvider[] {
  const set = new Set<ByokModelProvider>();
  for (const row of orgKeys) {
    if (isGoogleByokProvider(row.provider)) set.add("google");
    else if (isOpenRouterByokProvider(row.provider)) set.add("openai-compatible");
    else if (normalizeProvider(row.provider) === "openai") {
      set.add("openai");
      if (row.baseUrl?.trim()) set.add("openai-compatible");
    } else if (normalizeProvider(row.provider) === "anthropic") set.add("anthropic");
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
 * Hosted Vantage keys only — used by Bugbot Ultra. Never silently uses org BYOK.
 * Honest ChatProviderResolutionError when ANTHROPIC_API_KEY / managed peek / OpenRouter are absent.
 */
async function resolveHostedPlatformChatAdapter(
  client: PoolClient,
  input: ResolveOrgChatAdapterInput,
): Promise<ChatAdapter> {
  const hostedAnthropic = tryCreateHostedAnthropicAdapter({
    promptCachingEnabled: input.promptCachingEnabled,
    fetchImpl: input.fetchImpl,
    feature: input.feature,
  });
  if (hostedAnthropic) return hostedAnthropic;

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

  const openrouter = tryCreateOpenRouterFreeAdapter({
    promptCachingEnabled: input.promptCachingEnabled,
    fetchImpl: input.fetchImpl,
    capability: input.feature,
  });
  if (openrouter) return openrouter;

  throw new ChatProviderResolutionError(
    "Bugbot Ultra needs a hosted Vantage model (ANTHROPIC_API_KEY, managed peek, or OPENROUTER_API_KEY). Use subscription Bugbot with your own key instead.",
  );
}

/**
 * Resolve a live HTTP chat adapter for an org.
 * Order: org BYOK / custom HTTPS → paid managed peek → paid Anthropic env →
 * free OpenRouter env → local-relay hard-fail → team 1111 sponsored pool.
 * Never falls back to LocalDeterministicChatAdapter — callers get an honest error
 * when no usable key exists. Metering still goes through meteredAI in the orchestrator.
 */
export async function resolveOrgChatAdapter(
  client: PoolClient,
  input: ResolveOrgChatAdapterInput,
): Promise<ChatAdapter> {
  return (await resolveOrgChatAdapterWithProvenance(client, input)).adapter;
}

/**
 * Same resolution as {@link resolveOrgChatAdapter}, plus provenance metadata
 * ({provider, modelId, baseUrlOrigin, source}) so every surface can say what
 * answered. Additive — existing callers keep using resolveOrgChatAdapter.
 */
export async function resolveOrgChatAdapterWithProvenance(
  client: PoolClient,
  input: ResolveOrgChatAdapterInput,
): Promise<ResolvedOrgChatAdapter> {
  let bridgeDegraded: BridgeDegradedReason | undefined;
  const resolved = (adapter: ChatAdapter, source: ResolvedModelSource): ResolvedOrgChatAdapter => ({
    adapter,
    provenance: chatAdapterProvenance(adapter, source),
    ...(bridgeDegraded ? { degraded: bridgeDegraded } : {}),
  });
  if (input.preferPlatform) {
    return resolved(await resolveHostedPlatformChatAdapter(client, input), "hosted");
  }

  // Subscription bridge first. Interactive chat-class features (BRIDGE_CHAT_FEATURES)
  // qualify on any preferred device; every other feature qualifies only on a device
  // whose subscriber opted into coverage='everything' (0488) — that is the "run all of
  // Vantage on my Claude account" switch.
  if (input.bridgeTransport && input.feature) {
    try {
      const devices = await client.query<{
        engines: Record<string, { available?: boolean } | undefined> | null;
        lastHeartbeatAt: Date | string | null;
        preferWhenOnline: boolean;
        coverage: string | null;
      }>(
        // coverage via to_jsonb so a 0486-but-not-0488 database answers NULL ('chat'
        // semantics) instead of erroring the whole bridge path away.
        `SELECT engines,
                last_heartbeat_at AS "lastHeartbeatAt",
                prefer_when_online AS "preferWhenOnline",
                (to_jsonb(ai_bridge_devices) ->> 'coverage') AS coverage
           FROM ai_bridge_devices
          WHERE org_id = $1::uuid AND revoked_at IS NULL
          ORDER BY last_heartbeat_at DESC NULLS LAST`,
        [input.orgId],
      );
      const interactive = BRIDGE_CHAT_FEATURES.has(input.feature);
      const covering = devices.rows.filter(
        (row) => row.preferWhenOnline && (interactive || row.coverage === "everything"),
      );
      const online = covering.find(
        (row) =>
          row.lastHeartbeatAt &&
          Date.now() - new Date(row.lastHeartbeatAt).getTime() < BRIDGE_ONLINE_WINDOW_MS,
      );
      const engines = online?.engines ?? {};
      const engine = engines.claude?.available
        ? ("claude" as const)
        : engines.codex?.available
          ? ("codex" as const)
          : null;
      if (online && engine) {
        const adapter = new SubscriptionBridgeChatAdapter({
          transport: input.bridgeTransport,
          orgId: input.orgId,
          userId: input.userId ?? null,
          feature: input.feature,
          requestedEngine: engine,
          // The normal key chain is the fall-through target, resolved LAZILY: the bridge
          // answering is the common case, and eagerly recursing here paid for routing
          // prefs, org+member key loads, a KMS decrypt and the sponsored-promo checks on
          // every bridged turn. An org with no other key still gets the bridge — the
          // factory throwing is read as "no fallback" → honest error on bridge failure.
          fallbackFactory: async () =>
            (
              await resolveOrgChatAdapterWithProvenance(client, {
                ...input,
                bridgeTransport: undefined,
              })
            ).adapter,
          // Heavy (non-chat-class) jobs get the long CLI budget and a poll budget
          // that outlasts it; the 0488 claim function grows the lease to match. Both
          // honor VANTAGE_BRIDGE_MAX_WAIT_MS, resolved here at call time.
          ...(interactive
            ? {}
            : {
                cliTimeoutMs: bridgeHeavyCliTimeoutMs(),
                totalBudgetMs: bridgeHeavyPollBudgetMs(),
              }),
        });
        return {
          adapter,
          provenance: {
            provider: "subscription-bridge",
            // Refined to the CLI-reported model on the adapter after each completed turn.
            modelId: adapter.model,
            baseUrlOrigin: null,
            source: "subscription-bridge",
          },
        };
      }
      // A device WOULD cover this feature but is stale/engine-less: say so, then fall
      // through. A chat-only device seeing a heavy feature is configuration, not
      // degradation — no claim in that case.
      if (covering.length > 0) bridgeDegraded = "bridge-offline";
    } catch {
      // ai_bridge_devices may not exist yet (pre-0486 deploys) — normal chain unchanged.
    }
  }
  const { prefs: storedPrefs, policy } = await loadRoutingPrefsAndPolicy(client, input.orgId);
  // Org selection policy overrides member/org picks: force_auto drops any fixed
  // model; allowlist coerces a disallowed fixed model to the best allowed one and
  // narrows the automode pool. Never an error mid-chat.
  const prefs = applyPolicyToRoutingPrefs(policy, storedPrefs, BYOK_MODEL_OPTIONS);
  const memberKeys = input.userId
    ? await loadMemberLlmKeys(client, input.orgId, input.userId)
    : [];
  const memberKeyIds = new Set(memberKeys.map((row) => row.id));
  const keyRowSource = (row: OrgKeyRow): ResolvedModelSource =>
    memberKeyIds.has(row.id) ? "member-key" : "org-key";

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

  const orgKeys = {
    rows: overlayMemberKeys(await loadOrgLlmKeys(client, input.orgId), memberKeys),
  };

  const available = availableProvidersFrom(orgKeys.rows, orgProviders.rows);
  const chosen = pickByokModelForFeature({
    feature: input.feature,
    mode: prefs.mode,
    fixedModelId: prefs.fixedModelId,
    enabledModelIds: prefs.enabledModelIds,
    availableProviders: available.filter((p) => p !== "openai-compatible") as ByokModelProvider[],
    difficulty: input.taskText ? classifyTaskDifficulty(input.taskText, input.feature) : undefined,
    role: input.autoRole ?? "execute",
    consulting: consultingAllowed({
      mode: prefs.mode,
      consultEnabled: input.consultEnabled,
      lockRun: input.lockRun,
    }),
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
        isOpenRouterByokProvider(row.provider) ||
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
      return resolved(
        new HttpChatAdapter({
          provider: "openai-compatible",
          model,
          apiKey,
          baseUrl: localOrCompat.baseUrl,
          promptCachingEnabled: input.promptCachingEnabled,
          prices,
          fetchImpl: input.fetchImpl,
        }),
        providerConfigSource(localOrCompat.baseUrl),
      );
    }
  }

  // First-party BYOK keys with Automode / fixed selection.
  if (chosen) {
    if (chosen.provider === "google") {
      const row = orgKeys.rows.find((r) => isGoogleByokProvider(r.provider));
      if (row) {
        const apiKey = await decryptRow(row, input.decrypt);
        return resolved(
          new HttpChatAdapter({
            provider: "openai-compatible",
            model: chosen.modelId,
            apiKey,
            baseUrl: GOOGLE_OPENAI_COMPAT_BASE,
            promptCachingEnabled: input.promptCachingEnabled,
            prices: pricesFromOption(chosen),
            fetchImpl: input.fetchImpl,
          }),
          keyRowSource(row),
        );
      }
    }
    if (chosen.provider === "openai-compatible") {
      const row = orgKeys.rows.find((r) => isOpenRouterByokProvider(r.provider));
      if (row) {
        const apiKey = await decryptRow(row, input.decrypt);
        return resolved(
          new HttpChatAdapter({
            provider: "openai-compatible",
            model: chosen.modelId || openRouterFreeModel(),
            apiKey,
            baseUrl: OPENROUTER_BASE_URL,
            promptCachingEnabled: input.promptCachingEnabled,
            prices: pricesFromOption(chosen),
            fetchImpl: input.fetchImpl,
            providerLabel: "openrouter",
            extraHeaders: openRouterRequestHeaders(),
          }),
          keyRowSource(row),
        );
      }
    }
    if (chosen.provider === "openai" || chosen.provider === "anthropic") {
      const row = orgKeys.rows.find((r) => normalizeProvider(r.provider) === chosen.provider);
      if (row) {
        const apiKey = await decryptRow(row, input.decrypt);
        return resolved(
          httpAdapterFromLlmKey(row, input, apiKey, chosen.modelId, pricesFromOption(chosen)),
          keyRowSource(row),
        );
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
    return resolved(
      new HttpChatAdapter({
        provider,
        model,
        apiKey,
        baseUrl: hosted.baseUrl ?? undefined,
        promptCachingEnabled: input.promptCachingEnabled,
        prices,
        fetchImpl: input.fetchImpl,
      }),
      providerConfigSource(hosted.baseUrl),
    );
  }

  // Fallback: first usable org_llm_keys row (pre-Automode behavior).
  for (const row of orgKeys.rows) {
    if (isOpenRouterByokProvider(row.provider)) {
      const apiKey = await decryptRow(row, input.decrypt);
      const model = openRouterFreeModel();
      return resolved(
        new HttpChatAdapter({
          provider: "openai-compatible",
          model,
          apiKey,
          baseUrl: OPENROUTER_BASE_URL,
          promptCachingEnabled: input.promptCachingEnabled,
          prices: { inputPerMillionUsd: 0, outputPerMillionUsd: 0 },
          fetchImpl: input.fetchImpl,
          providerLabel: "openrouter",
          extraHeaders: openRouterRequestHeaders(),
        }),
        keyRowSource(row),
      );
    }
    if (isGoogleByokProvider(row.provider)) {
      const apiKey = await decryptRow(row, input.decrypt);
      const prices = await catalogPrices(client, "google", GOOGLE_DEFAULT_MODEL, GOOGLE_DEFAULT_PRICES);
      return resolved(
        new HttpChatAdapter({
          provider: "openai-compatible",
          model: GOOGLE_DEFAULT_MODEL,
          apiKey,
          baseUrl: GOOGLE_OPENAI_COMPAT_BASE,
          promptCachingEnabled: input.promptCachingEnabled,
          prices,
          fetchImpl: input.fetchImpl,
        }),
        keyRowSource(row),
      );
    }
    const provider = normalizeProvider(row.provider);
    if (provider !== "openai" && provider !== "anthropic") continue;
    const model = row.model?.trim() || DEFAULT_MODELS[provider];
    const apiKey = await decryptRow(row, input.decrypt);
    const prices = await catalogPrices(client, provider, model, DEFAULT_PRICES[provider]);
    return resolved(httpAdapterFromLlmKey(row, input, apiKey, model, prices), keyRowSource(row));
  }

  // Keyless local connector last chance.
  if (localOrCompat?.baseUrl) {
    const apiKey = await decryptRow(localOrCompat, input.decrypt);
    const model = pickMappedModel(localOrCompat.modelMappings, DEFAULT_MODELS["openai-compatible"]);
    return resolved(
      new HttpChatAdapter({
        provider: "openai-compatible",
        model,
        apiKey,
        baseUrl: localOrCompat.baseUrl,
        promptCachingEnabled: input.promptCachingEnabled,
        prices: DEFAULT_PRICES["openai-compatible"],
        fetchImpl: input.fetchImpl,
      }),
      providerConfigSource(localOrCompat.baseUrl),
    );
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
        return resolved(
          new HttpChatAdapter({
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
          }),
          "hosted",
        );
      }
    }
    const hostedAnthropic = tryCreateHostedAnthropicAdapter({
      promptCachingEnabled: input.promptCachingEnabled,
      fetchImpl: input.fetchImpl,
      feature: input.feature,
    });
    if (hostedAnthropic) return resolved(hostedAnthropic, "hosted");
  }

  // A platform admin can open a time-boxed window onto the platform's own free relay
  // (FREE_RELAY_BASE_URL — a Freebuff/OpenCode-style OpenAI-compatible proxy) for one
  // team. Checked before the generic free pools because it is an explicit per-team
  // operator decision, and after everything above because the team's own keys always
  // get first refusal.
  //
  // The adapter is built from env FIRST so deployments with no relay configured pay no
  // database round-trip on this hot path. Granting relay access on a deployment that has
  // no relay is refused up front by the /api/admin/ai-grants route.
  //
  // The relay is a self-hosted box on a home connection drawing on a small daily pool,
  // so it is wrapped in a failover chain: unreachable or spent falls through to the
  // platform free pools rather than failing a team's request.
  const platformRelay = tryCreatePlatformRelayAdapter({
    promptCachingEnabled: input.promptCachingEnabled,
    fetchImpl: input.fetchImpl,
    capability: input.feature,
  });
  if (platformRelay && (await orgHasAiAccessGrant(client, input.orgId, "platform_relay"))) {
    return resolved(platformRelay, "platform-relay");
  }

  if (tier === "free") {
    const openrouter = tryCreateOpenRouterFreeAdapter({
      promptCachingEnabled: input.promptCachingEnabled,
      fetchImpl: input.fetchImpl,
      capability: input.feature,
    });
    if (openrouter) return resolved(openrouter, "hosted");
  }

  if (orgProviders.rows.some((row) => row.localRelay)) {
    throw new ChatProviderResolutionError(
      "Configured providers use the local desktop relay, which cannot serve hosted chat. Add an OpenAI-compatible base URL under Team → AI API keys, or an HTTPS OpenAI/Anthropic key.",
    );
  }

  // Platform-sponsored promo pool (team 1111 within window) before free-tier BYOK hard fail.
  // Expiry only cuts off this pool — never org membership or non-AI product routes.
  if (tier === "free") {
    const promo = await resolveSponsoredPromoForOrg(client, input.orgId);
    if (promo.eligible) {
      const sponsored = tryCreateSponsoredFailoverAdapter({
        promptCachingEnabled: input.promptCachingEnabled,
        fetchImpl: input.fetchImpl,
      });
      if (sponsored) return resolved(sponsored, "sponsored");
    }
    if (!promo.eligible && promo.reason === "promo_expired") {
      await maybeNotifySponsoredPromoExpired(client, input.orgId, promo);
      throw new ChatProviderResolutionError(sponsoredPromoExpiredMessage(promo.teamNumber ?? 1111));
    }
    throw new ChatProviderResolutionError(
      "No AI provider key is configured for this organization. Free workspaces use the platform OpenRouter free pool when OPENROUTER_API_KEY is set, or your own OpenAI, Anthropic, Google, or OpenRouter key under Team → AI API keys (or a local OpenAI-compatible base URL for Ollama / LM Studio).",
    );
  }

  throw new ChatProviderResolutionError(
    "No AI provider key is available. Add OpenAI / Anthropic / Google / OpenRouter under Team → AI API keys, configure a local OpenAI-compatible connector, or set ANTHROPIC_API_KEY for paid hosted Sonnet/Opus.",
  );
}
