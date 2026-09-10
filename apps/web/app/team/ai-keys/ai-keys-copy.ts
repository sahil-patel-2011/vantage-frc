// Page copy for /team/ai-keys, kept as data so the promises stay pinned by tests.
//
// The promise this page makes: Vantage speaks the OpenAI chat-completions
// protocol, so ANY endpoint that speaks it works — a paid frontier key, a free
// tier, or a model running on a laptop in the shop. Vantage runs every one of
// its AI features through whatever is configured; it does not reserve features
// for expensive models. Smaller models get a quality notice on the answer, not
// a locked door.
//
// Honesty rules: nothing here claims a provider is free, unlimited, or
// currently reachable. Availability lives in FREE_KEY_PROVIDERS, which carries
// its own caveat.

export type EndpointExample = {
  id: string;
  /** How the team knows the thing. */
  name: string;
  /** Which slot on this page it goes in, in plain words. */
  howToUse: string;
};

/**
 * Concrete answers to "does it work with ___?". Every entry must be reachable
 * through a slot that actually exists on this page — a provider key card, or
 * the base-URL connector.
 */
export const ENDPOINT_EXAMPLES: EndpointExample[] = [
  { id: "openai", name: "OpenAI", howToUse: "OpenAI key card" },
  { id: "anthropic", name: "Anthropic", howToUse: "Anthropic key card" },
  {
    id: "google",
    name: "Google AI Studio (Gemini)",
    howToUse: "Google key card — has a free tier",
  },
  { id: "openrouter", name: "OpenRouter", howToUse: "OpenRouter key card — includes :free models" },
  { id: "groq", name: "Groq", howToUse: "OpenAI key card + Groq base URL" },
  { id: "mistral", name: "Mistral", howToUse: "OpenAI key card + Mistral base URL" },
  { id: "cerebras", name: "Cerebras", howToUse: "OpenAI key card + Cerebras base URL" },
  { id: "ollama", name: "Ollama", howToUse: "Local connector — base URL, usually no key" },
  { id: "lmstudio", name: "LM Studio", howToUse: "Local connector — base URL, usually no key" },
  {
    id: "other",
    name: "Anything else OpenAI-compatible",
    howToUse: "Local connector — paste its base URL",
  },
];

/**
 * The page-header subtitle. Deliberately NOT a closed list of "supported"
 * providers — it names examples and then says "any", because an enumeration is
 * read as the allowlist and teams conclude their endpoint is not welcome.
 */
export const PAGE_DESCRIPTION =
  "Point Vantage at any OpenAI-compatible endpoint — OpenAI, Anthropic, Google, OpenRouter, Groq, or a model running in your shop via Ollama or LM Studio. Every AI feature runs through whichever you configure. Fixed model or Automode by task toughness.";

/** The headline promise. One sentence, no hedging. */
export const ANY_ENDPOINT_HEADLINE =
  "If it speaks the OpenAI API, Vantage can use it.";

export const ANY_ENDPOINT_BODY =
  "Vantage talks the OpenAI chat-completions protocol, so anything with a base URL works: OpenAI, OpenRouter, Google AI Studio, Groq, Mistral, Cerebras, or a model running on a laptop in your shop through Ollama or LM Studio. Point it at whichever you have.";

/**
 * The feature-parity promise. This is the part teams most often assume is
 * false, so it is stated flatly and without an exception clause.
 */
export const ALL_FEATURES_BODY =
  "Every AI feature in Vantage — chat, the autonomous agent, scouting analysis, strategy, the CAD and code assistants, grant and sponsor writing — runs through whichever endpoint you configure here. Nothing is reserved for expensive models.";

/**
 * The counterweight, so parity never reads as a claim that all models are
 * equal. Informational, never a warning: choosing a small model is legitimate.
 */
export const QUALITY_NOTICE_BODY =
  "Smaller models give shorter, plainer answers than frontier models do. Where that applies, Vantage says so on the answer itself instead of hiding it — you always know what wrote what.";

/** Ordered bullets for the "bring any endpoint" panel. */
export const ANY_ENDPOINT_POINTS: string[] = [
  ALL_FEATURES_BODY,
  QUALITY_NOTICE_BODY,
  "Keys are encrypted at rest and never shown again after you save them. Vantage calls your endpoint directly with them and stores nothing from the response beyond what the feature shows you.",
];

// ---------------------------------------------------------------------------
// Personal ("Mine") keys — the same endpoint freedom, scoped to one account.
// ---------------------------------------------------------------------------

export const MEMBER_KEY_HEADLINE = "Use your own key, just for you";

export const MEMBER_KEY_BODY =
  "A key you save here belongs to your account alone. It overrides the team key for you in every AI feature and nobody else — admins included — can see or spend it. Remove it and you fall straight back to the team's setup.";

/**
 * The parity fields. `save_member_key` in /api/organizations/ai-keys honours a
 * base URL on the OpenAI entry only, because that is the slot that speaks the
 * plain OpenAI-compatible protocol; a model id is honoured on every provider.
 */
export const MEMBER_KEY_BASE_URL_HINT =
  "Optional. Point the OpenAI slot at anything OpenAI-compatible — Groq, Mistral, Cerebras, Together, or your own Ollama / LM Studio server. Leave blank for api.openai.com.";

export const MEMBER_KEY_MODEL_HINT =
  "Optional. The model id this key should use, e.g. llama3.2 or gpt-4.1-mini. Leave blank to use the team's routing.";

export type MemberKeyFields = {
  /** Always true — a personal entry without a key is not an entry. */
  apiKey: true;
  /** Whether a custom base URL is meaningful (and will be stored) for this provider. */
  baseUrl: boolean;
  /** Whether a model id is meaningful (and will be stored) for this provider. */
  model: boolean;
};

/**
 * Which fields the personal-key form must show for a provider.
 *
 * MUST mirror the server rule in `save_member_key`: base URL is validated and
 * stored only for `openai`; other providers ignore it, so offering the field
 * would promise something the route silently drops.
 */
export function memberKeyFields(provider: string | null | undefined): MemberKeyFields {
  const id = typeof provider === "string" ? provider.trim().toLowerCase() : "";
  return { apiKey: true, baseUrl: id === "openai", model: id !== "" };
}

/**
 * One-line summary of a stored personal key. Never invents an endpoint or a
 * model: an unset field is described as the inherited default, not guessed.
 */
export function describeMemberKey(row: {
  provider: string;
  baseUrl?: string | null;
  model?: string | null;
}): string {
  const host = memberKeyEndpointHost(row.baseUrl);
  const endpoint = host ? `via ${host}` : "via the provider's default endpoint";
  const model = row.model?.trim() ? `model ${row.model.trim()}` : "model from your team's routing";
  return `${endpoint} · ${model}`;
}

/** Host (plus port) of a stored base URL; null when absent or unparseable. */
export function memberKeyEndpointHost(baseUrl: string | null | undefined): string | null {
  const raw = typeof baseUrl === "string" ? baseUrl.trim() : "";
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

/** Endpoints every version of this page must name, per the product promise. */
export const REQUIRED_ENDPOINT_IDS = [
  "openai",
  "openrouter",
  "google",
  "groq",
  "mistral",
  "ollama",
  "lmstudio",
] as const;
