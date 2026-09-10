/** First-party BYOK providers for `/team/ai-keys` — stored in `org_llm_keys`. */

export const PRIMARY_BYOK_PROVIDERS = ["openai", "anthropic"] as const;
export const SECONDARY_BYOK_PROVIDERS = ["google", "openrouter"] as const;
export const BYOK_PROVIDERS = ["openai", "anthropic", "google", "openrouter"] as const;
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

export type ByokProviderMeta = {
  id: ByokProvider;
  label: string;
  shortLabel: string;
  placeholder: string;
  docsHint: string;
  /** Fixed label written to `org_llm_keys.label` for upsert-by-provider. */
  storageLabel: string;
};

export const BYOK_PROVIDER_META: Record<ByokProvider, ByokProviderMeta> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    shortLabel: "OpenAI",
    placeholder: "sk-…",
    docsHint: "Platform API key from platform.openai.com",
    storageLabel: "OpenAI (your key)",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "Anthropic",
    placeholder: "sk-ant-…",
    docsHint: "API key from console.anthropic.com",
    storageLabel: "Anthropic (your key)",
  },
  google: {
    id: "google",
    label: "Google (Gemini)",
    shortLabel: "Google",
    placeholder: "AIza…",
    docsHint: "Gemini API key from AI Studio / Google AI",
    storageLabel: "Google Gemini (your key)",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    shortLabel: "OpenRouter",
    placeholder: "sk-or-v1-…",
    docsHint: "API key from openrouter.ai — routes to free or paid models you choose",
    storageLabel: "OpenRouter (your key)",
  },
};

export const OPENAI_BASE_PRESETS = [
  { id: "openai", label: "OpenAI", baseUrl: "" },
  { id: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
] as const;

export type OpenaiBasePresetId = (typeof OPENAI_BASE_PRESETS)[number]["id"];

export function matchOpenaiBasePreset(baseUrl: string | null | undefined): OpenaiBasePresetId {
  const value = (baseUrl ?? "").trim().replace(/\/$/, "");
  if (!value) return "openai";
  if (value.includes("11434")) return "ollama";
  if (value.includes("1234")) return "lmstudio";
  return "openai";
}

export function parseOptionalBaseUrl(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim().replace(/\/$/, "");
  return text || null;
}

export function isByokProvider(value: string): value is ByokProvider {
  return (BYOK_PROVIDERS as readonly string[]).includes(value.trim().toLowerCase());
}

export function parseByokProvider(value: unknown): ByokProvider | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "gemini") return "google";
  return isByokProvider(normalized) ? normalized : null;
}

export type ByokKeyStatus = {
  provider: ByokProvider;
  label: string;
  configured: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
  baseUrl?: string | null;
  model?: string | null;
};

/** Build the Soft-UI status rows — configured / missing, never secret material. */
export function buildByokKeyStatuses(
  rows: Array<{
    provider: string;
    createdAt: string | null;
    lastUsedAt: string | null;
    baseUrl?: string | null;
    model?: string | null;
  }>,
): ByokKeyStatus[] {
  const latest = new Map<
    string,
    { createdAt: string | null; lastUsedAt: string | null; baseUrl: string | null; model: string | null }
  >();
  for (const row of rows) {
    const provider = parseByokProvider(row.provider);
    if (!provider) continue;
    const existing = latest.get(provider);
    if (!existing || (row.createdAt ?? "") > (existing.createdAt ?? "")) {
      latest.set(provider, {
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
        baseUrl: row.baseUrl ?? null,
        model: row.model ?? null,
      });
    }
  }
  return BYOK_PROVIDERS.map((provider) => {
    const hit = latest.get(provider);
    return {
      provider,
      label: BYOK_PROVIDER_META[provider].label,
      configured: Boolean(hit),
      createdAt: hit?.createdAt ?? null,
      lastUsedAt: hit?.lastUsedAt ?? null,
      baseUrl: hit?.baseUrl ?? null,
      model: hit?.model ?? null,
    };
  });
}

/** Gemini OpenAI-compatible chat completions base (no trailing slash). */
export const GOOGLE_OPENAI_COMPAT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai";

export const GOOGLE_DEFAULT_MODEL = "gemini-2.0-flash";
