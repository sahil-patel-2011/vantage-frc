import type { PoolClient } from "@neondatabase/serverless";
import { LOCAL_OPENAI_COMPAT_LABEL } from "./byok-model-routing";
import {
  decryptRow,
  loadMemberLlmKeys,
  loadOrgLlmKeys,
  type OrgKeyRow,
  type ResolveOrgChatAdapterInput,
  type ResolvedModelSource,
} from "./resolve-chat-adapter";
import { isLocalOrLanOrigin } from "./model-tier";

/**
 * Speech-to-text endpoint resolution through the same BYOK layer chat uses,
 * instead of a hardcoded provider URL. Any OpenAI-compatible base URL that
 * implements POST /audio/transcriptions (OpenAI Whisper, LocalAI,
 * faster-whisper-server, Speaches, …) works; endpoints without audio support
 * fail honestly at call time with a 404/405 the caller reports as
 * "endpoint lacks audio support" — never a fabricated transcript.
 */

export const DEFAULT_STT_MODEL = "whisper-1";
const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";

export type ResolvedSttEndpoint = {
  provider: "openai" | "openai-compatible";
  /** OpenAI-compatible API base (no trailing slash), e.g. https://api.openai.com/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  source: ResolvedModelSource;
  /** Origin only — safe to show in UI / logs. */
  baseUrlOrigin: string | null;
};

function originOnly(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function trimBase(url: string): string {
  return url.trim().replace(/\/$/, "");
}

function sttModelFromMappings(mappings: Record<string, string> | null | undefined): string {
  if (mappings && typeof mappings === "object") {
    const stt = mappings.stt ?? mappings.transcribe ?? mappings.whisper;
    if (typeof stt === "string" && stt.trim()) return stt.trim();
  }
  return DEFAULT_STT_MODEL;
}

function isOpenAiKeyRow(row: OrgKeyRow): boolean {
  return row.provider.trim().toLowerCase().includes("openai");
}

function endpointFromKeyRow(row: OrgKeyRow, apiKey: string, source: ResolvedModelSource): ResolvedSttEndpoint {
  const baseUrl = row.baseUrl?.trim() ? trimBase(row.baseUrl) : OPENAI_DEFAULT_BASE;
  return {
    provider: baseUrl === OPENAI_DEFAULT_BASE ? "openai" : "openai-compatible",
    baseUrl,
    apiKey,
    model: DEFAULT_STT_MODEL,
    source,
    baseUrlOrigin: originOnly(baseUrl),
  };
}

type SttProviderConfigRow = {
  id: string;
  kind: string;
  label: string;
  baseUrl: string | null;
  modelMappings: Record<string, string> | null;
  keyCiphertext: string | null;
  keyNonce: string | null;
  keyAuthTag: string | null;
  encryptedDek: string | null;
  kmsKeyId: string | null;
};

/**
 * Resolve where cloud STT should go for this org (and optionally this member).
 * Order matches chat resolution intent: member OpenAI key → org OpenAI key →
 * org OpenAI-compatible connector (Ollama/LM Studio/LocalAI base URL, key
 * optional) → platform OPENAI_API_KEY. Returns null when nothing is configured
 * — callers degrade to browser speech recognition, never a fake transcript.
 */
export async function resolveOrgSttEndpoint(
  client: PoolClient,
  input: {
    orgId: string;
    userId?: string;
    decrypt?: ResolveOrgChatAdapterInput["decrypt"];
    env?: NodeJS.ProcessEnv;
  },
): Promise<ResolvedSttEndpoint | null> {
  const env = input.env ?? process.env;

  const memberKeys = input.userId ? await loadMemberLlmKeys(client, input.orgId, input.userId) : [];
  const memberOpenAi = memberKeys.find(isOpenAiKeyRow);
  if (memberOpenAi) {
    const apiKey = await decryptRow(memberOpenAi, input.decrypt);
    if (apiKey || memberOpenAi.baseUrl?.trim()) {
      return endpointFromKeyRow(memberOpenAi, apiKey, "member-key");
    }
  }

  const orgKeys = await loadOrgLlmKeys(client, input.orgId);
  const orgOpenAi = orgKeys.find(isOpenAiKeyRow);
  if (orgOpenAi) {
    const apiKey = await decryptRow(orgOpenAi, input.decrypt);
    if (apiKey || orgOpenAi.baseUrl?.trim()) {
      return endpointFromKeyRow(orgOpenAi, apiKey, "org-key");
    }
  }

  const configs = await client.query<SttProviderConfigRow>(
    `SELECT id, kind, label, base_url AS "baseUrl",
            model_mappings AS "modelMappings",
            key_ciphertext AS "keyCiphertext", key_nonce AS "keyNonce",
            key_auth_tag AS "keyAuthTag", encrypted_dek AS "encryptedDek",
            kms_key_id AS "kmsKeyId"
       FROM org_provider_configs
      WHERE org_id = $1
        AND enabled = true
        AND disabled_at IS NULL
        AND local_relay = false
        AND base_url IS NOT NULL
      ORDER BY
        CASE WHEN label = $2 THEN 0 ELSE 1 END,
        created_at DESC`,
    [input.orgId, LOCAL_OPENAI_COMPAT_LABEL],
  );
  const config = configs.rows.find((row) => {
    const kind = row.kind.trim().toLowerCase();
    return kind.includes("openai") || kind.includes("compatible") || Boolean(row.baseUrl);
  });
  if (config?.baseUrl) {
    const apiKey = await decryptRow(config, input.decrypt);
    const baseUrl = trimBase(config.baseUrl);
    const origin = originOnly(baseUrl);
    return {
      provider: "openai-compatible",
      baseUrl,
      apiKey,
      model: sttModelFromMappings(config.modelMappings),
      source: isLocalOrLanOrigin(origin) ? "local-connector" : "org-key",
      baseUrlOrigin: origin,
    };
  }

  const platformKey = env.OPENAI_API_KEY?.trim();
  if (platformKey) {
    return {
      provider: "openai",
      baseUrl: OPENAI_DEFAULT_BASE,
      apiKey: platformKey,
      model: DEFAULT_STT_MODEL,
      source: "hosted",
      baseUrlOrigin: originOnly(OPENAI_DEFAULT_BASE),
    };
  }

  return null;
}

/** HTTP statuses that mean "this endpoint does not implement audio transcription". */
export function isSttUnsupportedStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}
