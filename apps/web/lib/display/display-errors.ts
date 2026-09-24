/**
 * What a pit TV says when its feed fails. The person reading it is standing at a TV with no
 * keyboard, so the words say what to do next rather than "Display unavailable".
 */

export const TV_LINK_DEAD =
  "This TV link no longer works. On a signed-in laptop, open Pit TV and make a new TV link.";
export const TV_SERVER_DOWN = "The pit TV can't reach Vantage right now. It keeps trying every 30 seconds.";

/** True when the database refused the token itself (revoked, expired, or never existed). */
export function isDeadTokenError(error: unknown): boolean {
  const message = String((error as Error | null)?.message ?? "");
  return /display token is invalid or expired|display board not found/i.test(message);
}

/** The JSON response for a failed TV feed: 401 for a dead link, 503 (logged) for anything else. */
export function displayFeedError(error: unknown, route: string): Response {
  if (isDeadTokenError(error)) {
    return Response.json({ error: TV_LINK_DEAD, code: "tv_link_dead" }, { status: 401 });
  }
  console.error(`[display] ${route} failed`, (error as Error | null)?.message ?? error);
  return Response.json({ error: TV_SERVER_DOWN, code: "tv_feed_unavailable" }, { status: 503 });
}
