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
  {
    id: "google:gemini-2.5-pro",
    provider: "google",
    modelId: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    tier: "high",
    tierLabel: "High reasoning",
    inputPerMillionUsd: 1.25,
    outputPerMillionUsd: 10,
  },
  {
    id: "google:gemini-2.0-flash",
    provider: "google",
    modelId: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    tier: "fast",
    tierLabel: "Fast / light",
    inputPerMillionUsd: 0.1,
    outputPerMillionUsd: 0.4,
  },
] as const;

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
}): ByokModelOption | null {
  const available = new Set(input.availableProviders);
  const catalog = BYOK_MODEL_OPTIONS.filter((m) => available.has(m.provider));
  if (!catalog.length) return null;

  if (input.mode === "fixed") {
    const fixed = catalog.find((m) => m.id === input.fixedModelId);
    return fixed ?? catalog[0] ?? null;
  }

  const enabledIds = input.enabledModelIds?.filter(Boolean) ?? [];
  const pool =
    enabledIds.length > 0
      ? catalog.filter((m) => enabledIds.includes(m.id))
      : catalog;
  if (!pool.length) return catalog[0] ?? null;

  const preferred = preferredTierForFeature(input.feature);
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
  return BYOK_MODEL_OPTIONS.find((m) => m.id === id) ?? null;
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
