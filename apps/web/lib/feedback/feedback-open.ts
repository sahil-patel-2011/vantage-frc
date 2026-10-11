import { isBugKind, type BugKind } from "./bug-report";

/**
 * One way to open the Send feedback dialog from anywhere: the corner button, the account menu,
 * the Help page. They do not import the dialog; they say so on window and the button, which
 * owns the dialog, listens. A page that cannot reach it can still fall back to /report-bug.
 */
export const FEEDBACK_OPEN_EVENT = "vantage:feedback-open";

export type FeedbackOpenDetail = { kind?: BugKind; handled?: boolean };

/**
 * Ask the dialog to open, optionally on a given kind. Returns whether a dialog answered, so a link
 * can fall back to its plain page (`/report-bug`) when nothing is listening: signed out, or the
 * app frame is not on this page. Always false on the server.
 */
export function openFeedback(kind?: BugKind): boolean {
  if (typeof window === "undefined") return false;
  const detail: FeedbackOpenDetail = kind ? { kind } : {};
  window.dispatchEvent(new CustomEvent<FeedbackOpenDetail>(FEEDBACK_OPEN_EVENT, { detail }));
  // Listeners run synchronously inside dispatchEvent, so by here the answer is in.
  return detail.handled === true;
}

/** What the event carried, tolerating a bare Event or a detail it does not know. */
export function feedbackOpenKind(event: Event): BugKind | undefined {
  const detail = (event as CustomEvent<{ kind?: unknown } | null>).detail;
  return isBugKind(detail?.kind) ? detail.kind : undefined;
}

/** The listener calls this once it has taken the request. */
export function markFeedbackHandled(event: Event): void {
  const detail = (event as CustomEvent<FeedbackOpenDetail | null>).detail;
  if (detail && typeof detail === "object") detail.handled = true;
}
