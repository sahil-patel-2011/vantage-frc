/**
 * Ask the provider whether a pasted key works, before Vantage stores it.
 *
 * A key that was never checked showed "Configured" and "Ask AI is ready" for anything typed
 * into the field ("hello" included), and the team only found out when chat failed later with
 * a provider error. Each check is a free, read-only call (a model or key listing), never a
 * completion, so it costs the team nothing.
 *
 * Only a clear "no" from the provider rejects the key. A timeout, a network failure or a
 * provider outage stores it anyway and says it could not be checked: a flaky connection at an
 * event must not stop a team from saving a key that is probably fine.
 */

import type { ByokProvider } from "./byok-providers";

export type ProviderKeyCheck =
  | { status: "valid" }
  | { status: "rejected"; message: string }
  | { status: "unchecked"; message: string };

const PROVIDER_NAME: Record<ByokProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  openrouter: "OpenRouter",
};

const WHERE_TO_COPY: Record<ByokProvider, string> = {
  openai: "copy it again from platform.openai.com/api-keys",
  anthropic: "copy it again from console.anthropic.com",
  google: "copy it again from Google AI Studio",
  openrouter: "copy it again from openrouter.ai/keys",
};

function probeRequest(provider: ByokProvider, apiKey: string): { url: string; headers: Record<string, string> } {
  switch (provider) {
    case "openai":
      return { url: "https://api.openai.com/v1/models", headers: { authorization: `Bearer ${apiKey}` } };
    case "anthropic":
      return {
        url: "https://api.anthropic.com/v1/models",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      };
    case "google":
      // The key goes in a header, not the query string, so it never lands in a URL log.
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        headers: { "x-goog-api-key": apiKey },
      };
    case "openrouter":
      // /models is public; /key is the endpoint that actually needs a valid key.
      return { url: "https://openrouter.ai/api/v1/key", headers: { authorization: `Bearer ${apiKey}` } };
  }
}

/** Google answers 400 "API key not valid" for a bad key rather than 401. */
async function isGoogleBadKey(response: Response): Promise<boolean> {
  if (response.status !== 400) return false;
  const text = await response.text().catch(() => "");
  return /api key not valid|API_KEY_INVALID/i.test(text);
}

export async function checkProviderKey(
  provider: ByokProvider,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderKeyCheck> {
  const name = PROVIDER_NAME[provider];
  const rejected: ProviderKeyCheck = {
    status: "rejected",
    message: `${name} didn't accept this key. Check you copied all of it, or ${WHERE_TO_COPY[provider]}.`,
  };
  const { url, headers } = probeRequest(provider, apiKey);
  let response: Response;
  try {
    response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(6_000), cache: "no-store" });
  } catch {
    return { status: "unchecked", message: `Saved. We couldn't reach ${name} to check the key just now.` };
  }
  if (response.ok) return { status: "valid" };
  if (response.status === 401 || response.status === 403) return rejected;
  if (provider === "google" && (await isGoogleBadKey(response))) return rejected;
  return { status: "unchecked", message: `Saved. ${name} didn't answer the key check (${response.status}), so it hasn't been tested yet.` };
}

/**
 * Local browser specs store an obviously fake key to prove keys never leak back out. They run
 * against a dev server with the E2E fixture on, never production, and are the only callers
 * allowed to skip the live check.
 */
export function skipsLiveKeyCheck(apiKey: string): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.E2E_AUTH_FIXTURE === "1" &&
    apiKey.startsWith("sk-vantage-spec-")
  );
}
