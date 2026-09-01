"use client";

// IndexedDB outbox for kiosk clock events — the whole point of the workstream.
// A shop or venue with dead Wi-Fi must still take attendance, and the recorded
// time must be when the student actually scanned, not when the network came
// back. Mirrors the structure of lib/scout-offline.ts (open → store → put →
// drain with withSyncBackoff) but keeps its own database so a kiosk tablet and
// a scouting tablet never fight over a schema version.

import { withSyncBackoff } from "../scouting/sync-backoff";
import type { KioskScanResult } from "./kiosk";
import {
  clockScanRequestBody,
  createQueuedClockEvent,
  isPermanentClockStatus,
  orderClockOutbox,
  type QueuedClockEvent,
} from "./outbox";

export type { QueuedClockEvent } from "./outbox";

const DB_NAME = "vantage-hours-kiosk";
const DB_VERSION = 1;
const OUTBOX = "clock-outbox";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);
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
  return typeof globalThis.indexedDB !== "undefined";
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
  const event = createQueuedClockEvent(input);
  const objectStore = await store("readwrite");
  await requestValue(objectStore.put(event));
  return event;
}

/** Oldest first — attendance must replay in the order it happened. */
export async function listQueuedClockEvents(orgId?: string): Promise<QueuedClockEvent[]> {
  const objectStore = await store("readonly");
  const all = await requestValue<QueuedClockEvent[]>(objectStore.getAll());
  const scoped = orgId ? all.filter((event) => event.orgId === orgId) : all;
  return orderClockOutbox(scoped);
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
    body: JSON.stringify(clockScanRequestBody(event)),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string } & Partial<KioskScanResult>;
  if (!response.ok) {
    const message = body.error ?? `Sync failed (${response.status})`;
    if (isPermanentClockStatus(response.status)) {
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
