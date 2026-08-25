/**
 * Providers that currently hand out FREE API keys usable through the existing
 * BYOK system (org or personal keys; OpenAI-compatible entries use the
 * base-URL override the key form already supports).
 *
 * Honesty rules: free tiers change without notice, every one of these is
 * rate-limited, and none is "unlimited" — the copy must say so. This list is
 * static guidance, not a live status; nothing here fabricates availability.
 */

export type FreeKeyProvider = {
  id: string;
  name: string;
  /** Which BYOK provider slot the key goes into. */
  byokProvider: "openai" | "anthropic" | "google" | "openrouter";
  /** Base URL to paste when the slot needs one (OpenAI-compatible endpoints). */
  baseUrl: string | null;
  /** Where the key comes from. */
  signupUrl: string;
  /** What the free tier is good for, in one honest line. */
  note: string;
};

export const FREE_KEY_PROVIDERS: FreeKeyProvider[] = [
  {
    id: "google-ai-studio",
    name: "Google AI Studio (Gemini)",
    byokProvider: "google",
    baseUrl: null,
    signupUrl: "https://aistudio.google.com/apikey",
    note: "Free Gemini API tier with daily request limits — the most generous mainstream free tier.",
  },
  {
    id: "groq",
    name: "Groq",
    byokProvider: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    signupUrl: "https://console.groq.com/keys",
    note: "Free tier for open models (Llama, etc.) — very fast, per-minute and per-day caps.",
  },
  {
    id: "openrouter-free",
    name: "OpenRouter (:free models)",
    byokProvider: "openrouter",
    baseUrl: null,
    signupUrl: "https://openrouter.ai/keys",
    note: "Models tagged :free (e.g. DeepSeek) cost nothing but share strict daily caps.",
  },
  {
    id: "mistral",
    name: "Mistral La Plateforme",
    byokProvider: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    signupUrl: "https://console.mistral.ai/api-keys",
    note: "Free experiment tier on Mistral models with per-second and per-month caps.",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    byokProvider: "openai",
    baseUrl: "https://api.cerebras.ai/v1",
    signupUrl: "https://cloud.cerebras.ai",
    note: "Free tier for open models at high speed — daily token caps.",
  },
];

/** The one-line caveat every free-key surface must show. */
export const FREE_KEY_CAVEAT =
  "Free tiers are rate-limited and change without notice — none is unlimited. Check the provider's current limits before a competition weekend.";

/** Setup steps for the panel — kept as data so tests can pin the copy. */
export function freeKeySetupSteps(providerName: string): string[] {
  return [
    `Create a free API key at ${providerName}.`,
    "Paste it under Team keys (or Mine for a personal key).",
    "For OpenAI-compatible providers, set the base URL shown here.",
    "Pick the provider's model in the key's model field when needed.",
  ];
}
