// Provenance policy for AI surfaces — pure, framework-free, unit-tested.
//
// Product rule: a team that points Vantage at Ollama, Groq, or a $0 free tier
// gets the SAME features as a team on a frontier key. What they are owed is an
// honest label ("via <endpoint> · <model>") and, on a small model, one
// informational line about what to expect. Never an error tone, never a nag —
// running local is a legitimate choice, not a degraded account.
//
// Never fabricate: when the API did not report a provider or model, say so
// plainly rather than guessing a plausible-looking name.

import { classifyModelTier, degradedNoticeCopy } from "@vantage/agent/model-tier";

/**
 * Metadata an AI route reports alongside a generated answer.
 *
 * Every field is optional so this stays structurally assignable from the
 * `{ provider, modelId, baseUrlOrigin, source }` object `@vantage/agent`
 * returns, whatever shape (or narrower union) that module settles on.
 */
export type ModelProvenance = {
  provider?: string | null;
  modelId?: string | null;
  /** Origin only (scheme + host + port) — never a full URL with a key in it. */
  baseUrlOrigin?: string | null;
  source?: string | null;
};

/**
 * Mirrors `ModelTier` in `@vantage/agent/src/model-tier.ts` exactly. The names
 * must not drift: this module and that one are both re-exported through
 * `components/ui`, and two same-named unions with different members would be a
 * silent footgun at every call site.
 */
export type ModelTier = "frontier" | "capable" | "small-or-local" | "unknown";

/** Shown when neither a provider nor a base URL origin was reported. */
export const UNKNOWN_ENDPOINT_LABEL = "your configured endpoint";
/** Shown when a run reported an endpoint but no model id. */
export const UNKNOWN_MODEL_LABEL = "model not reported";

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google AI Studio",
  "google-ai-studio": "Google AI Studio",
  gemini: "Google AI Studio",
  openrouter: "OpenRouter",
  groq: "Groq",
  mistral: "Mistral",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  "lm-studio": "LM Studio",
  together: "Together AI",
  fireworks: "Fireworks AI",
  deepseek: "DeepSeek",
  cerebras: "Cerebras",
  "openai-compatible": "OpenAI-compatible endpoint",
};

/** Canonical hosts we can name more kindly than the raw domain. */
const HOST_LABELS: Record<string, string> = {
  "api.openai.com": "OpenAI",
  "api.anthropic.com": "Anthropic",
  "openrouter.ai": "OpenRouter",
  "generativelanguage.googleapis.com": "Google AI Studio",
  "api.groq.com": "Groq",
  "api.mistral.ai": "Mistral",
  "api.together.xyz": "Together AI",
  "api.deepseek.com": "DeepSeek",
};

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Reduce a reported origin to the host (plus port, which is the whole point of
 * `localhost:11434`). Returns null for anything unparseable rather than echoing
 * a malformed string back at the user.
 */
export function provenanceOriginHost(baseUrlOrigin: string | null | undefined): string | null {
  const raw = clean(baseUrlOrigin);
  if (!raw) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname) return null;
    return url.port ? `${url.hostname}:${url.port}` : url.hostname;
  } catch {
    return null;
  }
}

/**
 * What to print after "via". A reported origin wins over the provider name: if
 * an `openai` key is pointed at Groq, the host is the truth about what answered.
 * Known canonical hosts are mapped back to their friendly product names.
 */
export function provenanceEndpointLabel(meta: ModelProvenance): string {
  const host = provenanceOriginHost(meta.baseUrlOrigin);
  if (host) return HOST_LABELS[host.toLowerCase()] ?? host;
  const provider = clean(meta.provider);
  if (provider) return PROVIDER_LABELS[provider.toLowerCase()] ?? provider;
  return UNKNOWN_ENDPOINT_LABEL;
}

/** The muted one-liner: `via OpenRouter · deepseek/deepseek-r1`. */
export function provenanceLabel(meta: ModelProvenance): string {
  const model = clean(meta.modelId) || UNKNOWN_MODEL_LABEL;
  return `via ${provenanceEndpointLabel(meta)} · ${model}`;
}

const SOURCE_LABELS: Record<string, string> = {
  member: "your personal key",
  personal: "your personal key",
  org: "your team's key",
  team: "your team's key",
  byok: "your team's key",
  local: "your local connector",
  hosted: "Vantage hosted credits",
  managed: "Vantage hosted credits",
  sponsored: "a sponsored key",
};

/** Optional trailing clause naming which key paid for the call. Null when unreported. */
export function provenanceSourceLabel(source: string | null | undefined): string | null {
  const raw = clean(source).toLowerCase();
  if (!raw) return null;
  return SOURCE_LABELS[raw] ?? null;
}

/** True when there is genuinely nothing to show — render nothing rather than a shrug. */
export function hasProvenance(meta: ModelProvenance | null | undefined): boolean {
  if (!meta) return false;
  return Boolean(clean(meta.provider) || clean(meta.modelId) || clean(meta.baseUrlOrigin));
}

/** Resolve the notice for a run, preferring a caller-supplied one from `@vantage/agent`. */
export function provenanceNotice(
  meta: ModelProvenance,
  supplied?: string | null,
): string | null {
  if (typeof supplied === "string") return supplied.trim() || null;
  if (supplied === null) return null;
  return degradedNoticeCopy(
    classifyModelTier({
      provider: meta.provider,
      modelId: meta.modelId,
      baseUrlOrigin: meta.baseUrlOrigin,
    }).tier,
    meta.modelId ?? "",
  );
}

/**
 * Stable per-session dismissal key. Keyed by endpoint + model so switching to a
 * different small model surfaces the notice once more, but re-running the same
 * model does not re-nag.
 */
export function provenanceNoticeId(meta: ModelProvenance): string {
  const endpoint = provenanceEndpointLabel(meta).toLowerCase();
  const model = clean(meta.modelId).toLowerCase() || "unknown-model";
  return `vantage:model-notice:${endpoint}:${model}`;
}
