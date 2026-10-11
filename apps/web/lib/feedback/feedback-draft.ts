import { BUG_DESCRIPTION_MAX, isBugKind, type BugKind } from "./bug-report";

/**
 * An unsent note survives an accidental close (a stray Escape, a tap outside, a reload). It lives in
 * sessionStorage, so it is this tab's and ends with it, and it is cleared the moment a send
 * succeeds. Every read and write is wrapped: storage can be blocked or full, and the dialog has to
 * work exactly the same without it.
 */
export const FEEDBACK_DRAFT_KEY = "vantage.feedback.draft.v1";

export type FeedbackDraft = { kind: BugKind; text: string };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readFeedbackDraft(storage: StorageLike | null = defaultStorage()): FeedbackDraft | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(FEEDBACK_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { kind?: unknown; text?: unknown } | null;
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) return null;
    return {
      kind: isBugKind(parsed.kind) ? parsed.kind : "bug",
      text: parsed.text.slice(0, BUG_DESCRIPTION_MAX),
    };
  } catch {
    return null;
  }
}

/** An empty note is not a draft: writing one removes whatever was kept. */
export function writeFeedbackDraft(draft: FeedbackDraft, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (!draft.text.trim()) storage.removeItem(FEEDBACK_DRAFT_KEY);
    else storage.setItem(FEEDBACK_DRAFT_KEY, JSON.stringify({ kind: draft.kind, text: draft.text }));
  } catch {
    // Private window or full storage: the note simply is not kept.
  }
}

export function clearFeedbackDraft(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(FEEDBACK_DRAFT_KEY);
  } catch {
    // Nothing to clear if storage cannot be reached.
  }
}
