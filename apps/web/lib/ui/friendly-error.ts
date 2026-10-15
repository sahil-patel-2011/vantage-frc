/**
 * Words for a caught fetch error. A timeout surfaced as the browser's own "signal timed out", and
 * a dropped request as "Failed to fetch"; the server's own message (thrown on purpose) stays.
 */
export function friendlyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "This is taking longer than usual. Try again.";
  }
  if (error instanceof TypeError) return "Couldn't reach Vantage. Check your connection and try again.";
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
