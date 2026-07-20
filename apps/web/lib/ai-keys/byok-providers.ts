/** First-party BYOK providers for `/team/ai-keys` — stored in `org_llm_keys`. */

export const BYOK_PROVIDERS = ["openai", "anthropic", "google"] as const;
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
    storageLabel: "OpenAI (BYOK)",
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "Anthropic",
    placeholder: "sk-ant-…",
    docsHint: "API key from console.anthropic.com",
    storageLabel: "Anthropic (BYOK)",
  },
  google: {
    id: "google",
    label: "Google (Gemini)",
    shortLabel: "Google",
    placeholder: "AIza…",
    docsHint: "Gemini API key from AI Studio / Google AI",
    storageLabel: "Google Gemini (BYOK)",
  },
};

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
};

/** Build the three Soft-UI status rows — configured / missing, never secret material. */
export function buildByokKeyStatuses(
  rows: Array<{ provider: string; createdAt: string | null; lastUsedAt: string | null }>,
): ByokKeyStatus[] {
  const latest = new Map<string, { createdAt: string | null; lastUsedAt: string | null }>();
  for (const row of rows) {
    const provider = parseByokProvider(row.provider);
    if (!provider) continue;
    const existing = latest.get(provider);
    if (!existing) {
      latest.set(provider, { createdAt: row.createdAt, lastUsedAt: row.lastUsedAt });
      continue;
    }
    // Keep the newest createdAt when multiple legacy rows exist.
    if ((row.createdAt ?? "") > (existing.createdAt ?? "")) {
      latest.set(provider, { createdAt: row.createdAt, lastUsedAt: row.lastUsedAt });
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
    };
  });
}

/** Gemini OpenAI-compatible chat completions base (no trailing slash). */
export const GOOGLE_OPENAI_COMPAT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai";

export const GOOGLE_DEFAULT_MODEL = "gemini-2.0-flash";
