/**
 * "Showing the last copy on this device": a page whose refresh failed while it still has a good
 * saved copy. That is a status, not an error — the page works — so it reads calmly and, offline,
 * stays out of sight: the offline banner already says the same thing at the top. Hiding is live
 * (the app shell marks <html data-network="offline">, and CSS hides .is-stale lines), not decided
 * when the refresh failed, so reconnecting brings the note back while the copy is still on screen.
 *
 * It used to be "Could not refresh X. Showing the last copy on this device." in an amber warning
 * box with role="alert", on ~200 pages, offline included, right under the offline banner.
 */

const TAIL = "Showing the last copy on this device.";

/** The line for a failed refresh with a saved copy on screen. */
export function staleCopyNotice(feature?: string): string {
  const what = feature?.trim();
  return what ? `Couldn't refresh ${what} just now. ${TAIL}` : `Couldn't refresh just now. ${TAIL}`;
}

export function isStaleCopyNotice(message: unknown): boolean {
  return typeof message === "string" && message.endsWith(TAIL);
}

/**
 * Props for the line that shows a page's message: a calm status for the saved-copy notice, the
 * page's usual alert for a real failure. `base` is the line's usual class.
 */
export function staleCopyProps(message: unknown, base = "telemetry-status"): { className: string; role: "status" | "alert" } {
  return isStaleCopyNotice(message) ? { className: `${base} is-stale`, role: "status" } : { className: base, role: "alert" };
}
