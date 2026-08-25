"use client";

// IndexedDB outbox for kiosk clock events — the whole point of the workstream.
// A shop or venue with dead Wi-Fi must still take attendance, and the recorded
// time must be when the student actually scanned, not when the network came
// back. Mirrors the structure of lib/scout-offline.ts (open → store → put →
// drain with withSyncBackoff) but keeps its own database so a kiosk tablet and
// a scouting tablet never fight over a schema version.

import { withSyncBackoff } from "../scouting/sync-backoff";
import type { KioskScanResult } from "./kiosk";
import { newClientEventId } from "./scan-codes";

const DB_NAME = "vantage-hours-kiosk";
const DB_VERSION = 1;
const OUTBOX = "clock-outbox";

export type QueuedClockEvent = {
  /**
   * Idempotency key AND IndexedDB primary key. Stable across every retry of this
   * scan — and carried over from a failed online attempt — so the server can
   * tell a replay from a genuinely new sign-in.
   */
  clientId: string;
  orgId: string;
  /** Normalized scan code — the server resolves it to a member. */
  code: string;
  kind: string;
  /** When the student actually scanned. Sent as `occurredAt`. */
  occurredAt: string;
  /** Optimistic label so the pending list reads as names, not codes. */
  displayName: string | null;
  queuedAt: string;
  /** Populated when the server permanently rejected the event. */
  lastError?: string;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "clientId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(mode: IDBTransactionMode) {
  const db = await openDatabase();
  return db.transaction(OUTBOX, mode).objectStore(OUTBOX);
}

/** True when this browser can queue at all — a kiosk without it must say so. */
export function offlineQueueSupported(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function queueClockEvent(input: {
  orgId: string;
  code: string;
  kind: string;
  displayName?: string | null;
  occurredAt?: string;
  /**
   * Reuse the id the failed online attempt already sent. That request may have
   * been committed before the response was lost, so the queued copy has to be
   * recognisable as the SAME scan or the replay toggles the member twice.
   */
  clientId?: string;
}): Promise<QueuedClockEvent> {
  if (!input.orgId) throw new Error("orgId is required to queue a clock event");
  const event: QueuedClockEvent = {
    clientId: input.clientId ?? newClientEventId(),
    orgId: input.orgId,
    code: input.code,
    kind: input.kind,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    displayName: input.displayName ?? null,
    queuedAt: new Date().toISOString(),
  };
  const objectStore = await store("readwrite");
  await requestValue(objectStore.put(event));
  return event;
}

/** Oldest first — attendance must replay in the order it happened. */
export async function listQueuedClockEvents(orgId?: string): Promise<QueuedClockEvent[]> {
  const objectStore = await store("readonly");
  const all = await requestValue<QueuedClockEvent[]>(objectStore.getAll());
  const scoped = orgId ? all.filter((event) => event.orgId === orgId) : all;
  return scoped.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.clientId.localeCompare(b.clientId));
}

export async function pendingClockCount(orgId?: string): Promise<number> {
  if (!offlineQueueSupported()) return 0;
  const queued = await listQueuedClockEvents(orgId);
  return queued.length;
}

export async function removeQueuedClockEvent(clientId: string): Promise<void> {
  const objectStore = await store("readwrite");
  await requestValue(objectStore.delete(clientId));
}

async function markQueuedError(event: QueuedClockEvent, message: string): Promise<void> {
  const objectStore = await store("readwrite");
  await requestValue(objectStore.put({ ...event, lastError: message }));
}

/** A 4xx will never succeed on retry — surface it instead of looping forever. */
function isPermanentStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export type SyncClockOutboxResult = {
  synced: number;
  /** Permanently rejected and left in the queue with a visible reason. */
  rejected: Array<{ clientId: string; displayName: string | null; reason: string }>;
  /** Still queued after this pass (transient failures + rejections). */
  remaining: number;
};

async function pushOne(event: QueuedClockEvent): Promise<KioskScanResult> {
  const response = await fetch("/api/hours/kiosk", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "scan",
      orgId: event.orgId,
      code: event.code,
      kind: event.kind,
      occurredAt: event.occurredAt,
      clientEventId: event.clientId,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & Partial<KioskScanResult>;
  if (!response.ok) {
    const message = body.error ?? `Sync failed (${response.status})`;
    if (isPermanentStatus(response.status)) {
      const permanent = new Error(message);
      permanent.name = "PermanentClockRejection";
      throw permanent;
    }
    throw new Error(message);
  }
  return body as KioskScanResult;
}

/**
 * Drain the queue once the network is back. Events replay oldest-first with the
 * timestamp they were captured at, so a two-hour outage produces the real
 * 6:02pm / 8:31pm log rather than a burst at reconnect.
 */
export async function syncClockOutbox(
  orgId: string,
  options?: { signal?: AbortSignal; maxAttempts?: number },
): Promise<SyncClockOutboxResult> {
  if (!offlineQueueSupported()) return { synced: 0, rejected: [], remaining: 0 };
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { synced: 0, rejected: [], remaining: await pendingClockCount(orgId) };
  }
  const queued = await listQueuedClockEvents(orgId);
  let synced = 0;
  const rejected: SyncClockOutboxResult["rejected"] = [];

  for (const event of queued) {
    if (options?.signal?.aborted) break;
    if (typeof navigator !== "undefined" && navigator.onLine === false) break;
    let permanent: Error | null = null;
    try {
      await withSyncBackoff(
        async () => {
          try {
            return await pushOne(event);
          } catch (error) {
            if (error instanceof Error && error.name === "PermanentClockRejection") {
              permanent = error;
              throw new DOMException("Aborted", "AbortError");
            }
            throw error;
          }
        },
        { maxAttempts: options?.maxAttempts ?? 3, signal: options?.signal },
      );
      await removeQueuedClockEvent(event.clientId);
      synced += 1;
    } catch {
      if (permanent) {
        const reason = (permanent as Error).message;
        // Never silently drop attendance: keep the row and show the mentor why.
        await markQueuedError(event, reason);
        rejected.push({ clientId: event.clientId, displayName: event.displayName, reason });
      }
      /* transient failure — stays queued for the next reconnect */
    }
  }

  return { synced, rejected, remaining: await pendingClockCount(orgId) };
}
