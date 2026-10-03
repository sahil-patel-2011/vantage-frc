/**
 * BYOK model pool — real provider API model IDs used in this codebase / public APIs.
 *
 * Display names like "GPT 5.6 Sol" in `model_catalog` are Vantage hosted labels with
 * env-configured provider IDs. For org BYOK we only offer concrete API model strings
 * that OpenAI / Anthropic / Google / OpenAI-compatible servers accept.
 *
 * Public list rates snapshot: 2026-07-20
 * Sources:
 * - OpenAI API pricing (platform.openai.com/docs/pricing)
 * - Anthropic API pricing (docs.anthropic.com/en/docs/about-claude/pricing)
 * - Google AI Gemini API pricing (ai.google.dev/pricing)
 */

export type ByokModelTier = "high" | "mid" | "fast";

export type ByokModelProvider = "openai" | "anthropic" | "google" | "openai-compatible";

export type ByokModelOption = {
  /** Stable id persisted in org_byok_routing_prefs (e.g. openai:gpt-4.1-mini). */
  id: string;
  provider: ByokModelProvider;
  /** Exact provider API model string. */
  modelId: string;
  label: string;
  tier: ByokModelTier;
  tierLabel: string;
  /** USD per 1M input tokens — public list rate snapshot. */
  inputPerMillionUsd: number;
  /** USD per 1M output tokens — public list rate snapshot. */
  outputPerMillionUsd: number;
  /**
   * The provider gives this model no free-tier quota. Automode never routes to it; a team
   * that pays for it picks it on purpose (Fixed model).
   */
  paidKeyOnly?: boolean;
};

export const BYOK_MODEL_OPTIONS: readonly ByokModelOption[] = [
  {
    id: "openai:gpt-4.1",
    provider: "openai",
    modelId: "gpt-4.1",
    label: "GPT-4.1",
    tier: "high",
    tierLabel: "High reasoning",
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 8,
  },
  {
    id: "openai:gpt-4.1-mini",
    provider: "openai",
    modelId: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    tier: "fast",
    tierLabel: "Fast / light",
    inputPerMillionUsd: 0.4,
    outputPerMillionUsd: 1.6,
  },
  {
    id: "anthropic:claude-opus-4-20250514",
    provider: "anthropic",
    modelId: "claude-opus-4-20250514",
    label: "Claude Opus 4",
    tier: "high",
    tierLabel: "High reasoning",
    inputPerMillionUsd: 15,
    outputPerMillionUsd: 75,
  },
  {
    id: "anthropic:claude-sonnet-4-20250514",
    provider: "anthropic",
    modelId: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    tier: "mid",
    tierLabel: "Strong (strategy)",
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
  },
  {
    id: "anthropic:claude-sonnet-5",
    provider: "anthropic",
    modelId: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    tier: "mid",
    tierLabel: "Strong (strategy)",
    inputPerMillionUsd: 3,
    outputPerMillionUsd: 15,
  },
  {
    id: "anthropic:claude-haiku-4-5",
    provider: "anthropic",
    modelId: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    tier: "fast",
    tierLabel: "Fast / light",
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
  },
  // Google rows re-checked against the live API and ai.google.dev pricing on 2026-10-03:
  // gemini-2.5-pro and gemini-2.0-flash answer 404 "no longer available". Pro has no free
  // tier (its free quota is 0), so it is paidKeyOnly; the two Flash models are what a free
  // AI Studio key runs on. Quota is counted per model, so splitting light and hard asks
  // across the two also doubles what one free key can do.
  {
    id: "google:gemini-3.1-pro-preview",
    provider: "google",
    modelId: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (paid Google key)",
    tier: "high",
    tierLabel: "High reasoning",
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 12,
    paidKeyOnly: true,
  },
  {
    id: "google:gemini-3.8-flash",
    provider: "google",
    modelId: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    tier: "mid",
    tierLabel: "Strong (strategy)",
    // List rate through 2026-12-31; Google has announced $1.50 / $7.50 from 2027-01-01.
    inputPerMillionUsd: 0.75,
    outputPerMillionUsd: 3.75,
  },
  {
    id: "google:gemini-3.5-flash-lite",
    provider: "google",
    modelId: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    tier: "fast",
    tierLabel: "Fast / light",
    inputPerMillionUsd: 0.3,
    outputPerMillionUsd: 2.5,
  },
] as const;

/** The strongest Gemini model a free AI Studio key can call. */
export const GOOGLE_FREE_TIER_MODEL = "gemini-3.8-flash";

/**
 * Free-tier input tokens per minute, per model, per Google project. Measured on 2026-10-03
 * by sending an oversized request with a free key: both Flash models answered
 * "GenerateContentInputTokensPerModelPerMinute-FreeTier, limit: 250000". Google publishes
 * the number only inside AI Studio, so this is the source.
 */
export const GOOGLE_FREE_TIER_INPUT_TPM = 250_000;

/**
 * Ids of models a provider has retired, mapped to their replacement. Ids are persisted
 * (org_byok_routing_prefs, org_model_policy), so a retired one must keep meaning something
 * or a team's saved Automode pool silently empties.
 */
const RETIRED_BYOK_MODEL_IDS: Record<string, string> = {
  "google:gemini-2.5-pro": "google:gemini-3.1-pro-preview",
  "google:gemini-2.0-flash": "google:gemini-3.8-flash",
};

export function canonicalByokModelId(id: string): string {
  return RETIRED_BYOK_MODEL_IDS[id] ?? id;
}

/** Fixed label for the Ollama / LM Studio org_provider_configs row. */
export const LOCAL_OPENAI_COMPAT_LABEL = "OpenAI-compatible (Ollama / LM Studio)";
export const LOCAL_OPENAI_COMPAT_KIND = "openai-compatible";

export const BYOK_RATES_SNAPSHOT_DATE = "2026-07-20";
export const BYOK_RATES_DISCLAIMER =
  "Estimated from public list rates (not an invoice). Snapshot dated " +
  BYOK_RATES_SNAPSHOT_DATE +
  ". Your provider bill may differ.";

/** Feature → preferred toughness tier for Automode. */
export function preferredTierForFeature(feature: string | null | undefined): ByokModelTier {
  const f = (feature ?? "chat").trim().toLowerCase();
  if (
    f === "cad" ||
    f === "coding" ||
    f === "code" ||
    f.includes("cad") ||
    f.includes("code")
  ) {
    return "high";
  }
  if (
    f === "strategy" ||
    f === "research" ||
    f === "prediction" ||
    f === "team_intel" ||
    f === "intel" ||
    f.includes("strategy")
  ) {
    return "mid";
  }
  return "fast";
}

const TIER_RANK: Record<ByokModelTier, number> = { high: 3, mid: 2, fast: 1 };

/**
 * Pick a model from the enabled pool for Automode.
 * Prefers exact tier match among available providers; otherwise nearest higher, then lower.
 */
export function pickByokModelForFeature(input: {
  feature?: string | null;
  mode: "fixed" | "automode";
  fixedModelId?: string | null;
  enabledModelIds?: string[] | null;
  availableProviders: ByokModelProvider[];
  difficulty?: "light" | "hard";
  role?: "execute" | "think";
  consulting?: boolean;
}): ByokModelOption | null {
  const available = new Set(input.availableProviders);
  const catalog = BYOK_MODEL_OPTIONS.filter((m) => available.has(m.provider));
  if (!catalog.length) return null;

  // Only a deliberate Fixed pick reaches a model with no free tier.
  const freeTier = catalog.filter((m) => !m.paidKeyOnly);
  const automatic = freeTier.length ? freeTier : catalog;

  if (input.mode === "fixed") {
    const fixedId = input.fixedModelId ? canonicalByokModelId(input.fixedModelId) : null;
    const fixed = catalog.find((m) => m.id === fixedId);
    return fixed ?? automatic[0] ?? null;
  }

  const enabledIds = (input.enabledModelIds?.filter(Boolean) ?? []).map(canonicalByokModelId);
  const pool =
    enabledIds.length > 0
      ? automatic.filter((m) => enabledIds.includes(m.id))
      : automatic;
  if (!pool.length) return automatic[0] ?? null;

  const preferred: ByokModelTier = input.difficulty
    ? input.difficulty === "light"
      ? "fast"
      : input.consulting && input.role !== "think"
        ? "mid"
        : "high"
    : preferredTierForFeature(input.feature);
  const exact = pool.filter((m) => m.tier === preferred);
  if (exact.length) {
    return exact.sort((a, b) => a.inputPerMillionUsd - b.inputPerMillionUsd)[0]!;
  }

  const ranked = [...pool].sort((a, b) => {
    const aDist = Math.abs(TIER_RANK[a.tier] - TIER_RANK[preferred]);
    const bDist = Math.abs(TIER_RANK[b.tier] - TIER_RANK[preferred]);
    if (aDist !== bDist) return aDist - bDist;
    if (preferred === "high") return TIER_RANK[b.tier] - TIER_RANK[a.tier];
    return a.inputPerMillionUsd - b.inputPerMillionUsd;
  });
  return ranked[0] ?? null;
}

export function findByokModelOption(id: string | null | undefined): ByokModelOption | null {
  if (!id) return null;
  const canonical = canonicalByokModelId(id);
  return BYOK_MODEL_OPTIONS.find((m) => m.id === canonical) ?? null;
}

export function estimateByokCostUsd(input: {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
}): number {
  const provider = input.provider.trim().toLowerCase();
  const model = input.model.trim().toLowerCase();
  const hit =
    BYOK_MODEL_OPTIONS.find(
      (m) =>
        m.modelId.toLowerCase() === model &&
        (m.provider === provider ||
          (provider === "openai-compatible" && (m.provider === "google" || m.provider === "openai"))),
    ) ?? BYOK_MODEL_OPTIONS.find((m) => m.modelId.toLowerCase() === model);
  if (!hit) return 0;
  return (
    (input.promptTokens * hit.inputPerMillionUsd +
      input.completionTokens * hit.outputPerMillionUsd) /
    1_000_000
  );
}
