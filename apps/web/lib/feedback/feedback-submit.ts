import { BUG_DESCRIPTION_MAX, type BugKind } from "./bug-report";

/**
 * Building and sending a note from the Send feedback dialog. What goes out is exactly what the
 * dialog's note promises and nothing else: the words, the page, the team on the page, and the
 * screen size. No browser string, no account details (the server knows who is signed in).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FeedbackPayload = {
  kind: BugKind;
  description: string;
  route: string | null;
  orgId: string | null;
  clientInfo: { viewportWidth: number; viewportHeight: number } | null;
};

export function buildFeedbackPayload(input: {
  kind: BugKind;
  text: string;
  /** window.location.pathname + search. The server drops the hash and any other origin. */
  route: string | null;
  /** The team from the URL, or the active team; ignored unless it is a real id. */
  orgId: string | null | undefined;
  viewport: { width: number; height: number } | null;
}): FeedbackPayload {
  const width = Math.round(input.viewport?.width ?? 0);
  const height = Math.round(input.viewport?.height ?? 0);
  return {
    kind: input.kind,
    description: input.text.trim().slice(0, BUG_DESCRIPTION_MAX),
    route: input.route && input.route.startsWith("/") ? input.route.slice(0, 2000) : null,
    orgId: input.orgId && UUID.test(input.orgId) ? input.orgId : null,
    clientInfo: width > 0 && height > 0 ? { viewportWidth: width, viewportHeight: height } : null,
  };
}

/** Said when the request never got an answer: offline, dropped, or too slow. */
export const FEEDBACK_NOT_SENT = "Not sent. Check your connection and try again.";

/**
 * One plain sentence for what went wrong, by status. The note stays in the box either way, so the
 * sentence says what to do next, never what the server said (those are for the logs, not for a
 * 14-year-old).
 */
export function feedbackErrorMessage(status: number): string {
  if (status === 0) return FEEDBACK_NOT_SENT;
  if (status === 401) return "Your session ended. Sign in again, and your note will still be here.";
  if (status === 429) return "That's a lot of notes at once. Give it a few minutes, then try again.";
  if (status === 400 || status === 413 || status === 415) {
    return "We couldn't read that note. Check it and try again.";
  }
  return "Something went wrong on our side. Your note is still here, so try again in a moment.";
}

export type FeedbackResult = { ok: true } | { ok: false; status: number; message: string };

export const FEEDBACK_TIMEOUT_MS = 15_000;

export async function sendFeedback(
  payload: FeedbackPayload,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = FEEDBACK_TIMEOUT_MS,
): Promise<FeedbackResult> {
  try {
    const response = await fetchImpl("/api/feedback/bug", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) return { ok: true };
    return { ok: false, status: response.status, message: feedbackErrorMessage(response.status) };
  } catch {
    // Offline, a dropped connection, or the timeout: all "it did not get there".
    return { ok: false, status: 0, message: FEEDBACK_NOT_SENT };
  }
}
