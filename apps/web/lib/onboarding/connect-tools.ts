/**
 * "Connect tools (optional)" — the provider list shown once onboarding is
 * finished and the person is on a team.
 *
 * Why it lives on the finish screen and not as a fourth step: the three setup
 * steps are the server's draft contract (`profile | team | preferences`, see
 * onboarding-flow.ts), and every key API below is scoped to a team
 * (`orgId` + membership). Before the onboarding POST there is no team to attach
 * a key to, so a step there could only collect keys it had nowhere to put.
 *
 * Rules this list is held to (connect-tools.test.ts):
 *   - Only providers the EXISTING key APIs can store and the AI routing can use.
 *     No parallel key store: team tool keys go to /api/organizations/tool-keys,
 *     personal model keys to /api/organizations/ai-keys `save_member_key`
 *     (member_llm_keys).
 *   - Every cost label is one of five fixed strings, checked on the provider's
 *     own pricing or docs page on the date below; the URL is in `sources`.
 *     Where a detail could not be confirmed (Mistral phone verification, exact
 *     Groq/Mistral free limits) the note says where to look instead of
 *     guessing.
 *   - Every row says, in one sentence, what skipping it costs.
 *
 * Pricing checked 2026-09-22. Re-check before changing a label.
 */

import type { ByokProvider } from "../ai-keys/byok-providers";

export const CONNECT_COST_LABELS = [
  "Free",
  "Free tier with limits",
  "Trial",
  "Paid",
  "Requires billing info",
] as const;
export type ConnectCostLabel = (typeof CONNECT_COST_LABELS)[number];

/** Tools `/api/organizations/tool-keys` accepts (and 0667's CHECK allows). */
export const SUPPORTED_TEAM_TOOL_KEYS = ["tinyfish"] as const;
export type TeamToolKey = (typeof SUPPORTED_TEAM_TOOL_KEYS)[number];

export type ConnectToolStorage =
  /** org_tool_keys via /api/organizations/tool-keys — needs manage_api_keys; verified with TinyFish before storing. */
  | { kind: "team-tool"; tool: TeamToolKey }
  /**
   * member_llm_keys via /api/organizations/ai-keys `save_member_key` — any
   * member, for their own requests only. Not checked with the provider on save
   * (the existing route does not verify), so the UI says so.
   *
   * `baseUrl` + `model` are only honoured on provider "openai": that is how the
   * route stores an OpenAI-compatible endpoint (Mistral, Groq), and
   * resolve-chat-adapter then calls it as openai-compatible.
   */
  | { kind: "member-llm"; provider: ByokProvider; baseUrl?: string; model?: string }
  /** Supplied by the deployment; nothing to paste. */
  | { kind: "platform" };

export type ConnectToolProvider = {
  id: "tinyfish" | "mistral" | "google" | "groq" | "openrouter" | "tba";
  name: string;
  /** What adding it switches on, in one line. */
  unlocks: string;
  cost: ConnectCostLabel;
  /** Short, checked note on limits and requirements. */
  costNote: string;
  /** Provider pages the label was checked against. */
  sources: string[];
  /** Where to create a key. Null when there is nothing to create. */
  keyPageUrl: string | null;
  placeholder: string;
  storage: ConnectToolStorage;
  /** Who the saved key serves. */
  scopeNote: string;
  /** One sentence, starting "Skip for now —". */
  skipConsequence: string;
};

export const MISTRAL_OPENAI_COMPAT_BASE = "https://api.mistral.ai/v1";
export const GROQ_OPENAI_COMPAT_BASE = "https://api.groq.com/openai/v1";

const SHARED_SLOT_NOTE =
  "Your personal OpenAI-compatible key, used for your own Ask AI requests. Mistral and Groq share this one slot, so saving one replaces the other.";

export const CONNECT_TOOL_PROVIDERS: readonly ConnectToolProvider[] = [
  {
    id: "tinyfish",
    name: "TinyFish",
    unlocks: "Web search and page reading for Ask AI research, for the whole team.",
    cost: "Free tier with limits",
    // https://www.tinyfish.ai/pricing — "Search and Fetch are free", no card
    // needed; Search 30/min and 500/hour, Fetch 150 URLs/min and 1,000/day.
    costNote: "Search and Fetch are free with no card: 30 searches a minute (500 an hour) and 1,000 page fetches a day.",
    sources: ["https://www.tinyfish.ai/pricing"],
    // Same page as TINYFISH_KEY_PAGE_URL in packages/agent/src/tinyfish.ts
    // (not imported: that module is server code).
    keyPageUrl: "https://agent.tinyfish.ai/api-keys",
    placeholder: "sk-tinyfish-…",
    storage: { kind: "team-tool", tool: "tinyfish" },
    scopeNote: "A team key: every member's Ask AI can use it. Only members who manage API keys can add it.",
    skipConsequence: "Skip for now — web research in Ask AI stays off until a TinyFish key is added.",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    unlocks: "Mistral models (mistral-small-latest) for your own Ask AI requests.",
    cost: "Free tier with limits",
    // https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key
    //   — "API access is enabled by default with no credit card required."
    // https://docs.mistral.ai/admin/billing-usage/usage-limits — free mode has
    //   the lowest limits; the numbers are only on the account's Limits page.
    // Phone verification: not stated on either page, so not claimed either way.
    costNote: "Free mode needs no card. Its rate and monthly limits are the lowest tier and are shown on your Mistral account's Limits page.",
    sources: [
      "https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key",
      "https://docs.mistral.ai/admin/billing-usage/usage-limits",
    ],
    keyPageUrl: "https://console.mistral.ai/api-keys",
    placeholder: "Mistral API key",
    storage: {
      kind: "member-llm",
      provider: "openai",
      baseUrl: MISTRAL_OPENAI_COMPAT_BASE,
      // https://docs.mistral.ai/api — examples use mistral-small-latest / mistral-large-latest.
      model: "mistral-small-latest",
    },
    scopeNote: SHARED_SLOT_NOTE,
    skipConsequence: "Skip for now — Ask AI keeps using your team's AI setup for your requests.",
  },
  {
    id: "google",
    name: "Google AI Studio (Gemini)",
    unlocks: "Gemini models for your own Ask AI requests.",
    cost: "Free tier with limits",
    // https://ai.google.dev/gemini-api/docs/pricing — free tier on selected
    //   models, no billing needed; free-tier content "used to improve our products".
    // https://ai.google.dev/gemini-api/docs/rate-limits — limits vary by model
    //   and are shown in AI Studio.
    costNote: "Free on selected Gemini models with no billing info. Rate limits vary by model. Google may use free-tier prompts to improve its products.",
    sources: ["https://ai.google.dev/gemini-api/docs/pricing", "https://ai.google.dev/gemini-api/docs/rate-limits"],
    keyPageUrl: "https://aistudio.google.com/apikey",
    placeholder: "AIza…",
    storage: { kind: "member-llm", provider: "google" },
    scopeNote: "Your personal Gemini key, used for your own Ask AI requests.",
    skipConsequence: "Skip for now — Ask AI keeps using your team's AI setup for your requests.",
  },
  {
    id: "groq",
    name: "Groq",
    unlocks: "Fast open models (llama-3.3-70b-versatile) for your own Ask AI requests.",
    cost: "Free tier with limits",
    // https://console.groq.com/docs/rate-limits — a Free plan exists; exact
    //   limits are per organization on the account's limits page.
    // https://console.groq.com/docs/models — llama-3.3-70b-versatile is a
    //   production model; OpenAI-compatible base https://api.groq.com/openai/v1.
    costNote: "Free plan with per-model rate limits, listed on the limits page in your Groq account.",
    sources: ["https://console.groq.com/docs/rate-limits", "https://console.groq.com/docs/models"],
    keyPageUrl: "https://console.groq.com/keys",
    placeholder: "gsk_…",
    storage: {
      kind: "member-llm",
      provider: "openai",
      baseUrl: GROQ_OPENAI_COMPAT_BASE,
      model: "llama-3.3-70b-versatile",
    },
    scopeNote: SHARED_SLOT_NOTE,
    skipConsequence: "Skip for now — Ask AI keeps using your team's AI setup for your requests.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    unlocks: "One key for many models, including free ones, for your own Ask AI requests.",
    cost: "Free tier with limits",
    // https://openrouter.ai/docs/api-reference/limits — ":free" models: 20
    //   requests/min; 50/day, or 1,000/day after $10 of credits purchased.
    costNote: "Free models allow 20 requests a minute and 50 a day; 1,000 a day once you have bought $10 of credits.",
    sources: ["https://openrouter.ai/docs/api-reference/limits", "https://openrouter.ai/pricing"],
    keyPageUrl: "https://openrouter.ai/keys",
    placeholder: "sk-or-v1-…",
    storage: { kind: "member-llm", provider: "openrouter" },
    scopeNote: "Your personal OpenRouter key, used for your own Ask AI requests.",
    skipConsequence: "Skip for now — Ask AI keeps using your team's AI setup for your requests.",
  },
  {
    id: "tba",
    name: "The Blue Alliance",
    unlocks: "Events, match results and team data across Vantage.",
    cost: "Free",
    // https://www.thebluealliance.com/apidocs — Read API keys are created free
    //   from a TBA account. Vantage reads TBA with one platform key
    //   (TBA_AUTH_KEY, packages/reference/src/platform-key.ts); there is no
    //   per-team TBA key route, so there is nothing to paste here.
    costNote: "Provided by Vantage — one shared connection serves every team, so there is no key to add.",
    sources: ["https://www.thebluealliance.com/apidocs"],
    keyPageUrl: null,
    placeholder: "",
    storage: { kind: "platform" },
    scopeNote: "Provided by Vantage.",
    skipConsequence: "Skip for now — nothing changes; event and match data already comes through Vantage.",
  },
];

/** True for providers the person pastes a key for. */
export function connectToolTakesKey(provider: ConnectToolProvider): boolean {
  return provider.storage.kind !== "platform";
}

export type ConnectToolSaveRequest = {
  url: "/api/organizations/tool-keys" | "/api/organizations/ai-keys";
  body: Record<string, string>;
};

/** The request the EXISTING key route expects for this provider. Null for platform rows. */
export function buildConnectToolSaveRequest(
  provider: ConnectToolProvider,
  orgId: string,
  apiKey: string,
): ConnectToolSaveRequest | null {
  const key = apiKey.trim();
  const storage = provider.storage;
  if (storage.kind === "platform") return null;
  if (storage.kind === "team-tool") {
    return { url: "/api/organizations/tool-keys", body: { orgId, tool: storage.tool, apiKey: key } };
  }
  const body: Record<string, string> = {
    orgId,
    action: "save_member_key",
    provider: storage.provider,
    apiKey: key,
  };
  if (storage.baseUrl) body.baseUrl = storage.baseUrl;
  if (storage.model) body.model = storage.model;
  return { url: "/api/organizations/ai-keys", body };
}

/** A personal key row as GET /api/organizations/ai-keys returns it (`memberKeys`). */
export type MemberKeyRow = {
  provider: string;
  baseUrl: string | null;
  model: string | null;
  createdAt: string | null;
};

function sameBase(a: string | null | undefined, b: string): boolean {
  return (a ?? "").trim().replace(/\/+$/, "").toLowerCase() === b.toLowerCase();
}

/** The saved personal key that belongs to this provider, if any. Never carries key material. */
export function memberKeyFor(provider: ConnectToolProvider, rows: readonly MemberKeyRow[]): MemberKeyRow | null {
  const storage = provider.storage;
  if (storage.kind !== "member-llm") return null;
  return (
    rows.find((row) => {
      if (row.provider.trim().toLowerCase() !== storage.provider) return false;
      if (storage.baseUrl) return sameBase(row.baseUrl, storage.baseUrl);
      return true;
    }) ?? null
  );
}

/** Masked, display-safe status for a saved key. Only ever the API's last-four hint. */
export function savedKeyLabel(input: { hint?: string | null; createdAt?: string | null; verified?: boolean }): string {
  const hint = input.hint && /^[A-Za-z0-9_-]{1,4}$/.test(input.hint) ? `a key ending …${input.hint}` : "a key";
  const verified = input.verified ? ", checked with the provider" : "";
  return `Saved: ${hint}${verified}. The key itself is never shown again.`;
}
