/**
 * Pure model-tier classifier — no I/O, no env. Given the provenance of a
 * resolved chat adapter ({provider, modelId, baseUrlOrigin}), says how capable
 * the answering model likely is so every surface can set expectations honestly.
 *
 * HONESTY RULE: "unknown" never claims degradation — an unrecognized model id
 * is simply a custom choice, and the reason says exactly that.
 *
 * Family patterns verified against this codebase's catalogs (2026-08):
 * - BYOK pool: gpt-4.1 / gpt-4.1-mini, claude-opus-4 / claude-sonnet-4 /
 *   claude-sonnet-5 / claude-haiku-4-5, gemini-2.5-pro / gemini-2.0-flash
 *   (packages/agent/src/byok-model-routing.ts).
 * - Hosted platform: claude-sonnet-4 / claude-opus-4 (hosted-platform-keys.ts).
 * - Sponsored pool: mistral-small-latest, llama-3.1-8b-instant, llama3.1-8b,
 *   command-r-08-2024 (sponsored-provider-pool.ts).
 * - Local connectors (Ollama / LM Studio): llama / qwen / gemma / phi /
 *   mistral-small / deepseek-distill class models.
 */

export type ModelTier = "frontier" | "capable" | "small-or-local" | "unknown";

export type ModelTierResult = {
  tier: ModelTier;
  /** One-line, non-alarmist explanation of the classification. */
  reason: string;
};

export type ModelTierInput = {
  provider?: string | null;
  modelId: string | null | undefined;
  /** Origin only (e.g. "http://127.0.0.1:11434") — never a full URL or key. */
  baseUrlOrigin?: string | null;
};

const PROVIDER_DEFAULT_ORIGINS = new Set([
  "https://api.openai.com",
  "https://api.anthropic.com",
  "https://generativelanguage.googleapis.com",
  "https://openrouter.ai",
  "https://api.mistral.ai",
  "https://api.groq.com",
  "https://api.cohere.ai",
  "https://api.cerebras.ai",
]);

/**
 * True when an origin points at localhost or a private/LAN address — the
 * signature of an Ollama / LM Studio / self-hosted OpenAI-compatible server.
 */
export function isLocalOrLanOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    host = origin.trim().toLowerCase().replace(/^\[|\]$/g, "");
  }
  host = host.replace(/^\[|\]$/g, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  if (host.endsWith(".local") || host.endsWith(".lan") || host.endsWith(".internal")) return true;
  // IPv4 loopback / RFC1918 / link-local ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  // Bare machine names ("gaming-pc", "workshop-server") only resolve on a LAN.
  if (!host.includes(".")) return true;
  return false;
}

const FRONTIER_PATTERNS: RegExp[] = [
  // Anthropic flagship families (Opus / Sonnet, any current generation).
  /claude[-\s._]?(3[-.]?[57]?[-\s._]?)?(opus|sonnet)/,
  // OpenAI flagship families: GPT-5 family and full-size GPT-4.1 / GPT-4o / o-series.
  /gpt[-\s._]?5(?![\w.-]*(mini|nano))/,
  /gpt[-\s._]?4\.1(?![\w.-]*(mini|nano))/,
  /gpt[-\s._]?4o(?![\w.-]*mini)/,
  /^o[13](-pro|-preview)?$/,
  // Google Gemini Pro class (2.5 Pro and successors).
  /gemini[-\s._]?\d+(\.\d+)?[-\s._]?pro/,
];

const CAPABLE_PATTERNS: RegExp[] = [
  // Hosted mini / flash / haiku-class models.
  /haiku/,
  /gpt[-\s._]?[\w.]*[-.](mini|nano)/,
  /gemini[-\s._]?\d+(\.\d+)?[-\s._]?flash/,
  /command[-\s._]?(r|a)/,
  /mistral[-\s._]?(medium|large)/,
  // OpenRouter's rotating free router serves capable hosted models.
  /^openrouter\/free$/,
];

const SMALL_OR_LOCAL_PATTERNS: RegExp[] = [
  /llama/, // llama-3.x, codellama, tinyllama, llama3.1-8b …
  /qwen/,
  /gemma/,
  /\bphi[-\s._]?\d/,
  /^phi$/,
  /mistral[-\s._]?(small|tiny|nemo)/,
  /ministral/,
  /deepseek[\w.-]*distill/,
  /smollm/,
  /vicuna/,
  /granite/,
  /olmo/,
  /starcoder/,
  /^vantage-local/, // deterministic offline fallback
];

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

/**
 * Classify how capable the resolved model likely is.
 * Anything served from a localhost/LAN origin is small-or-local by definition —
 * that is the whole point of running on your own hardware.
 */
export function classifyModelTier(input: ModelTierInput): ModelTierResult {
  const modelId = (input.modelId ?? "").trim().toLowerCase();
  const provider = (input.provider ?? "").trim().toLowerCase();
  const origin = input.baseUrlOrigin?.trim() || null;

  if (origin && !PROVIDER_DEFAULT_ORIGINS.has(origin.toLowerCase()) && isLocalOrLanOrigin(origin)) {
    return {
      tier: "small-or-local",
      reason: "served from a local/LAN endpoint — models that fit on your own hardware",
    };
  }

  if (provider === "local" || matchesAny(SMALL_OR_LOCAL_PATTERNS, modelId)) {
    return {
      tier: "small-or-local",
      reason: "small/open-weight model family (llama/qwen/gemma/phi/mistral-small class)",
    };
  }

  if (matchesAny(FRONTIER_PATTERNS, modelId)) {
    return {
      tier: "frontier",
      reason: "current flagship family (Claude Opus/Sonnet, GPT-5/4.1, Gemini Pro class)",
    };
  }

  if (matchesAny(CAPABLE_PATTERNS, modelId)) {
    return {
      tier: "capable",
      reason: "fast hosted mini/flash/haiku-class model",
    };
  }

  return {
    tier: "unknown",
    reason: "custom model — quality depends on what you chose",
  };
}

/**
 * One-line notice for surfaces that show what answered. Returns null for
 * frontier models (nothing to say). Never alarmist — the app keeps working on
 * every tier; this only sets output-quality expectations.
 */
export function degradedNoticeCopy(tier: ModelTier, modelId: string): string | null {
  const name = modelId.trim() || "the configured model";
  switch (tier) {
    case "frontier":
      return null;
    case "capable":
      return `Running on ${name} — a fast, capable model; frontier models may give deeper answers.`;
    case "small-or-local":
      return `Running on ${name} — a smaller model than Vantage's frontier defaults; expect rougher output.`;
    case "unknown":
      return `Running on ${name} — custom model; quality depends on what you chose.`;
  }
}
