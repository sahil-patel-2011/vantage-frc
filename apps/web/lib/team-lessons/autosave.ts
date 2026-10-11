/**
 * The editor's autosave rules, kept pure so they are unit-tested rather than discovered by a
 * student who lost an evening's writing:
 *
 *   - save about a second after the last change (debounce), one request at a time;
 *   - on a dropped connection or a server hiccup, keep the text and retry with backoff;
 *   - on a refusal (bad field, no permission) say why and wait for the next change;
 *   - on 409 someone else saved first: stop and let the person choose;
 *   - keep a copy of the unsaved draft in this browser until the server confirms it.
 *
 * Client-safe.
 */

import { parseLessonBody, parseLessonMeta } from "./body";
import { DEFAULT_LESSON_TITLE, type LessonBody, type LessonSource } from "./types";

export const AUTOSAVE_DEBOUNCE_MS = 1000;
/** Backoff between retries after a failed save; the last value repeats. */
export const RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 30000] as const;
/** fetch(…, { keepalive: true }) refuses bodies over 64 KiB; leave room for headers. */
export const KEEPALIVE_LIMIT_BYTES = 60_000;

export function retryDelay(attempt: number): number {
  const index = Math.max(0, Math.min(attempt, RETRY_DELAYS_MS.length - 1));
  return RETRY_DELAYS_MS[index]!;
}

export type LessonDraft = {
  title: string;
  summary: string;
  audience: string;
  minutes: number | null;
  body: LessonBody;
};

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "retrying"; attempt: number }
  | { kind: "error"; message: string }
  | { kind: "conflict" };

/** The quiet status line under the editor's title. */
export function saveStatusText(state: SaveState, now: number): string {
  switch (state.kind) {
    case "idle":
      return "All changes saved";
    case "saving":
      return "Saving…";
    case "saved": {
      const seconds = Math.max(0, Math.round((now - state.at) / 1000));
      if (seconds < 60) return "Saved just now";
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return `Saved ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
      return "Saved over an hour ago";
    }
    case "retrying":
      return "Couldn't save — retrying";
    case "error":
      return `Couldn't save: ${state.message}`;
    case "conflict":
      return "Someone else edited this — reload";
  }
}

export type SaveOutcome = "ok" | "conflict" | "retry" | "refused";

/** What to do after a save answered with this HTTP status (0 = no answer at all). */
export function classifySaveStatus(status: number): SaveOutcome {
  if (status >= 200 && status < 300) return "ok";
  if (status === 409) return "conflict";
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "refused";
}

export function draftStorageKey(lessonId: string): string {
  return `vantage.team-lessons.draft.${lessonId}`;
}

export type StoredDraft = {
  v: 1;
  lessonId: string;
  /** The server version this draft was edited from. */
  baseVersion: number;
  savedAt: number;
  draft: LessonDraft;
};

export function encodeStoredDraft(lessonId: string, baseVersion: number, draft: LessonDraft, now: number): string {
  const stored: StoredDraft = { v: 1, lessonId, baseVersion, savedAt: now, draft };
  return JSON.stringify(stored);
}

/** Reads a stored draft back, or null when it is missing, for another lesson, or malformed. */
export function decodeStoredDraft(raw: string | null, lessonId: string): StoredDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1 || record.lessonId !== lessonId) return null;
  if (typeof record.baseVersion !== "number" || typeof record.savedAt !== "number") return null;
  const draft = record.draft as Record<string, unknown> | null;
  if (typeof draft !== "object" || draft === null) return null;
  const meta = parseLessonMeta({ title: draft.title, summary: draft.summary, audience: draft.audience, minutes: draft.minutes ?? null });
  const body = parseLessonBody(draft.body);
  if (!meta.ok || !body.ok) return null;
  return {
    v: 1,
    lessonId,
    baseVersion: record.baseVersion,
    savedAt: record.savedAt,
    draft: {
      title: meta.value.title ?? "",
      summary: meta.value.summary ?? "",
      audience: meta.value.audience ?? "",
      minutes: meta.value.minutes ?? null,
      body: body.value,
    },
  };
}

/** The server stores the title trimmed (and an empty one as the default), so compare it that way. */
function comparable(draft: LessonDraft): LessonDraft {
  return { ...draft, title: draft.title.trim() || DEFAULT_LESSON_TITLE };
}

export function draftsEqual(a: LessonDraft, b: LessonDraft): boolean {
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}

/** The PATCH body for one save. */
export function autosavePayload(orgId: string, version: number, draft: LessonDraft): string {
  return JSON.stringify({ orgId, version, ...draft });
}

/** The editor shows the PDF panel instead of the steps when the lesson is a PDF. */
export function sourceLabel(source: LessonSource): string {
  return source === "pdf" ? "PDF lesson" : "Written in Vantage";
}
