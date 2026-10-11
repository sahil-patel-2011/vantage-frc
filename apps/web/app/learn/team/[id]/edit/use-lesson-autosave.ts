"use client";

/**
 * Autosave for the lesson editor. The rules live in lib/team-lessons/autosave.ts (tested);
 * this wires them to timers, fetch and the page lifecycle:
 *
 *   change → copy to this browser → wait ~1s of quiet → PATCH with the version last saved
 *   ok       → remember the new version; forget the browser copy if nothing changed since
 *   retry    → "Couldn't save — retrying", back off 2s, 4s, 8s, 15s, 30s…
 *   refused  → "Couldn't save: <why>"; the next change tries again
 *   conflict → stop; the page offers "Keep my version" or "Load their version"
 *
 * Leaving the field, the window or the page flushes at once; closing the tab sends a last
 * keepalive save when it fits, and the browser copy covers the rest.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTOSAVE_DEBOUNCE_MS,
  autosavePayload,
  classifySaveStatus,
  draftStorageKey,
  encodeStoredDraft,
  KEEPALIVE_LIMIT_BYTES,
  retryDelay,
  type LessonDraft,
  type SaveState,
} from "../../../../../lib/team-lessons/autosave";
import type { LessonBody, LessonSource } from "../../../../../lib/team-lessons/types";

export type ConflictCopy = LessonDraft & {
  version: number;
  source: LessonSource;
  pdfFileId: string | null;
  updatedAt: string;
  updatedByName: string | null;
};

const SAVE_TIMEOUT_MS = 20_000;

type SaveResponse ={ version?: number; error?: string; conflict?: ConflictCopy & { body: LessonBody } };

function writeLocal(lessonId: string, version: number, draft: LessonDraft) {
  try {
    window.localStorage.setItem(draftStorageKey(lessonId), encodeStoredDraft(lessonId, version, draft, Date.now()));
  } catch {
    /* Private windows and full storage: the server copy still saves. */
  }
}

export function clearLocalDraft(lessonId: string) {
  try {
    window.localStorage.removeItem(draftStorageKey(lessonId));
  } catch {
    /* nothing kept */
  }
}

export function useLessonAutosave({ lessonId, orgId, version }: { lessonId: string; orgId: string; version: number }) {
  const [state, setState] = useState<SaveState>({ kind: "idle" });
  const [conflict, setConflict] = useState<ConflictCopy | null>(null);
  const versionRef = useRef(version);
  const draftRef = useRef<LessonDraft | null>(null);
  const changeRef = useRef(0);
  const savedRef = useRef(0);
  const attemptRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef<Promise<void> | null>(null);
  const blockedRef = useRef(false);
  const runRef = useRef<() => Promise<void>>(async () => {});
  const leftWithRef = useRef(-1);

  const schedule = useCallback((delay: number) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void runRef.current();
    }, delay);
  }, []);

  const run = useCallback(async (): Promise<void> => {
    if (inflightRef.current) {
      // One save at a time; whatever changed meanwhile goes in the next one.
      await inflightRef.current;
      if (changeRef.current !== savedRef.current && !blockedRef.current) return run();
      return;
    }
    const draft = draftRef.current;
    const change = changeRef.current;
    if (!draft || change === savedRef.current || blockedRef.current) return;
    setState({ kind: "saving" });
    const work = (async () => {
      let status: number;
      let data: SaveResponse | null = null;
      try {
        const response = await fetch(`/api/team-lessons/${lessonId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: autosavePayload(orgId, versionRef.current, draft),
          // A request that never answers would hold up every later save; treat it as a retry.
          signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        });
        status = response.status;
        data = (await response.json().catch(() => null)) as SaveResponse | null;
      } catch {
        status = 0;
      }
      const outcome = classifySaveStatus(status);
      if (outcome === "ok" && typeof data?.version === "number") {
        versionRef.current = data.version;
        savedRef.current = change;
        attemptRef.current = 0;
        if (changeRef.current === change) {
          clearLocalDraft(lessonId);
          setState({ kind: "saved", at: Date.now() });
        } else if (draftRef.current) {
          writeLocal(lessonId, versionRef.current, draftRef.current);
        }
      } else if (outcome === "conflict") {
        blockedRef.current = true;
        setConflict(data?.conflict ?? null);
        setState({ kind: "conflict" });
      } else if (outcome === "retry" || outcome === "ok") {
        const delay = retryDelay(attemptRef.current);
        attemptRef.current += 1;
        setState({ kind: "retrying", attempt: attemptRef.current });
        schedule(delay);
      } else {
        setState({ kind: "error", message: data?.error ?? "Try again." });
      }
    })();
    inflightRef.current = work;
    try {
      await work;
    } finally {
      inflightRef.current = null;
    }
  }, [lessonId, orgId, schedule]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  /** Record a change: keep a browser copy now, save after a moment of quiet. */
  const change = useCallback(
    (draft: LessonDraft) => {
      draftRef.current = draft;
      changeRef.current += 1;
      writeLocal(lessonId, versionRef.current, draft);
      if (!blockedRef.current) schedule(AUTOSAVE_DEBOUNCE_MS);
    },
    [lessonId, schedule],
  );

  /** Save now (leaving a field, before publishing). Resolves when nothing is left unsaved or saving stopped. */
  const flush = useCallback(async () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await run();
    return changeRef.current === savedRef.current;
  }, [run]);

  /** After publish, restore, a PDF change or a reload: the server's version, nothing pending. */
  const reset = useCallback(
    (next: { version: number; draft: LessonDraft }) => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      versionRef.current = next.version;
      draftRef.current = next.draft;
      savedRef.current = changeRef.current;
      blockedRef.current = false;
      attemptRef.current = 0;
      setConflict(null);
      clearLocalDraft(lessonId);
      setState({ kind: "idle" });
    },
    [lessonId],
  );

  /** "Keep my version": save over theirs, starting from their version number. */
  const keepMine = useCallback(() => {
    if (!conflict) return;
    versionRef.current = conflict.version;
    blockedRef.current = false;
    setConflict(null);
    if (draftRef.current) writeLocal(lessonId, versionRef.current, draftRef.current);
    void run();
  }, [conflict, lessonId, run]);

  /** The version a server action (publish, attach) must quote. */
  const currentVersion = useCallback(() => versionRef.current, []);
  const setVersion = useCallback((next: number) => {
    versionRef.current = next;
  }, []);
  const hasUnsaved = useCallback(() => changeRef.current !== savedRef.current, []);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onBlur = () => void flush();
    // Closing the tab: one last save if it fits in a keepalive request; the browser copy
    // (written on every change) covers anything larger, and is offered back next time.
    const onLeave = (event: BeforeUnloadEvent | PageTransitionEvent) => {
      if (changeRef.current === savedRef.current || blockedRef.current || !draftRef.current) return;
      // beforeunload and pagehide both fire on close; send the last save once.
      if (leftWithRef.current === changeRef.current) return;
      const payload = autosavePayload(orgId, versionRef.current, draftRef.current);
      if (new TextEncoder().encode(payload).byteLength <= KEEPALIVE_LIMIT_BYTES) {
        leftWithRef.current = changeRef.current;
        try {
          void fetch(`/api/team-lessons/${lessonId}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: payload,
            keepalive: true,
          }).catch(() => undefined);
        } catch {
          /* the browser copy remains */
        }
      } else if (event.type === "beforeunload") {
        event.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onLeave);
    window.addEventListener("pagehide", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onLeave);
      window.removeEventListener("pagehide", onLeave);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [flush, lessonId, orgId]);

  return { state, conflict, change, flush, reset, keepMine, currentVersion, setVersion, hasUnsaved };
}
