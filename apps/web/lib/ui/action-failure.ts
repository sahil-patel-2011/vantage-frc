/**
 * What to say when a request a person started fails.
 *
 * `fetch` rejects with browser wording ("Failed to fetch", "Load failed", "NetworkError when
 * attempting to fetch resource") and `AbortSignal.timeout` with "signal timed out". Those reached
 * the screen on Business › Money, Reimbursements and Hours on venue Wi-Fi. A message the API wrote
 * for people (a 4xx `error`) is kept; transport failures become one sentence that says what
 * happened and what to do.
 */

export const CONNECTION_DROPPED =
  "The connection dropped before Vantage answered. Check your Wi-Fi, then try again.";

export const TOOK_TOO_LONG = "Vantage took too long to answer. Check your connection, then try again.";

const BROWSER_NETWORK_WORDS = [
  "failed to fetch",
  "load failed",
  "networkerror",
  "network request failed",
  "network error",
  "signal timed out",
  "the operation was aborted",
  "the user aborted a request",
];

function looksLikeTransport(message: string): boolean {
  const text = message.toLowerCase();
  return BROWSER_NETWORK_WORDS.some((words) => text.includes(words));
}

/** A person-readable sentence for a failed request; `fallback` when nothing better is known. */
export function actionFailureMessage(cause: unknown, fallback: string): string {
  if (cause && typeof cause === "object" && "name" in cause) {
    const name = String((cause as { name: unknown }).name);
    if (name === "TimeoutError") return TOOK_TOO_LONG;
    if (name === "AbortError") return CONNECTION_DROPPED;
  }
  const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
  if (!message.trim()) return fallback;
  if (cause instanceof TypeError || looksLikeTransport(message)) {
    return /timed out/i.test(message) ? TOOK_TOO_LONG : CONNECTION_DROPPED;
  }
  return message;
}
