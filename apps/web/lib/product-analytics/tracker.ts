/**
 * The tracker's behaviour, with every browser global injected.
 *
 * Keeping the queue/flush logic here — instead of inside a module that reaches
 * for `document` and `navigator` — means the two properties that actually
 * matter can be tested for real:
 *
 *   1. WITHOUT CONSENT THE TRACKER EMITS NOTHING. Not "queues and discards" —
 *      nothing is recorded at all, so a later "yes" cannot flush a backlog of
 *      activity gathered while the answer was no.
 *   2. IT NEVER BLOCKS THE UI. `track()` only appends to an array and arms a
 *      timer. Sending happens later, off the interaction, and a send that
 *      throws is swallowed: analytics failing must never break a page.
 */

import {
  MAX_BATCH_EVENTS,
  normalizePath,
  sanitizeMeta,
  type DeviceClass,
  type ProductEventInput,
  type ProductEventMeta,
  type ProductEventName,
} from "./events";

export type TrackerSend = (events: ProductEventInput[], reason: FlushReason) => void;

export type FlushReason = "timer" | "full" | "unload" | "manual";

export type TrackerOptions = {
  /** Re-read on every call, so revoking consent takes effect immediately. */
  hasConsent: () => boolean;
  /** Delivers a batch. Must not throw; the tracker guards it anyway. */
  send: TrackerSend;
  /** Current coarse device bucket. Re-read per event (a tablet can rotate). */
  deviceClass: () => DeviceClass;
  /** Arms the flush timer. Returns a handle passed back to `clearTimer`. */
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Milliseconds to wait before flushing a partial batch. */
  flushDelayMs?: number;
};

export type Tracker = {
  track: (event: ProductEventName, path: string, meta?: ProductEventMeta) => void;
  flush: (reason?: FlushReason) => void;
  /** Number of events waiting to be sent. Exposed for tests only. */
  pending: () => number;
};

const DEFAULT_FLUSH_DELAY_MS = 4000;

export function createTracker(options: TrackerOptions): Tracker {
  const flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  let queue: ProductEventInput[] = [];
  let timer: unknown = null;

  function disarm() {
    if (timer !== null) {
      try {
        options.clearTimer(timer);
      } catch {
        // A cleared-timer failure is not worth a broken page.
      }
      timer = null;
    }
  }

  function flush(reason: FlushReason = "manual") {
    disarm();
    if (!queue.length) return;
    // Consent can be withdrawn between queueing and flushing. The last word
    // wins, and the last word is "no": drop the batch instead of sending it.
    if (!safeHasConsent()) {
      queue = [];
      return;
    }
    const batch = queue;
    queue = [];
    try {
      options.send(batch, reason);
    } catch {
      // Deliberately not re-queued. Retrying analytics forever is how a
      // background task turns into a foreground problem.
    }
  }

  function safeHasConsent(): boolean {
    try {
      return options.hasConsent() === true;
    } catch {
      return false;
    }
  }

  function track(event: ProductEventName, path: string, meta?: ProductEventMeta) {
    // The gate is first, before any work at all.
    if (!safeHasConsent()) return;
    let deviceClass: DeviceClass;
    try {
      deviceClass = options.deviceClass();
    } catch {
      // A device we cannot classify is recorded as unknown, never guessed at.
      deviceClass = "unknown";
    }
    queue.push({
      event,
      path: normalizePath(path),
      deviceClass,
      meta: sanitizeMeta(meta),
    });
    if (queue.length >= MAX_BATCH_EVENTS) {
      flush("full");
      return;
    }
    if (timer === null) {
      try {
        timer = options.setTimer(() => {
          timer = null;
          flush("timer");
        }, flushDelayMs);
      } catch {
        timer = null;
      }
    }
  }

  return { track, flush, pending: () => queue.length };
}
