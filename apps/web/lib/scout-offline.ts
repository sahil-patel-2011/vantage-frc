"use client";

import type { SyncEntry } from "@vantage/scouting";

const DB_NAME = "vantage-scouting";
const DB_VERSION = 1;
const OUTBOX = "entry-outbox";
const MEDIA = "media-outbox";
const CACHE = "event-cache";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: "orgId" });
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

async function store(mode: IDBTransactionMode, name: string) {
  const db = await openDatabase();
  return db.transaction(name, mode).objectStore(name);
}

export function stableClientId(): string {
  return crypto.randomUUID();
}

export async function queueEntry(entry: SyncEntry): Promise<void> {
  const objectStore = await store("readwrite", OUTBOX);
  await requestValue(objectStore.put(entry));
}

export async function queueMedia(input: {
  clientId: string;
  metadata: Record<string, unknown>;
  blob: Blob;
}): Promise<void> {
  const objectStore = await store("readwrite", MEDIA);
  await requestValue(objectStore.put(input));
}

export async function cacheEvent(orgId: string, data: unknown): Promise<void> {
  const objectStore = await store("readwrite", CACHE);
  await requestValue(objectStore.put({ orgId, data, cachedAt: new Date().toISOString() }));
}

export async function getCachedEvent<T>(orgId: string): Promise<T | null> {
  const objectStore = await store("readonly", CACHE);
  const cached = await requestValue<{ data: T } | undefined>(objectStore.get(orgId));
  return cached?.data ?? null;
}

export async function pendingCounts(): Promise<{ entries: number; media: number }> {
  const [entryStore, mediaStore] = await Promise.all([
    store("readonly", OUTBOX),
    store("readonly", MEDIA),
  ]);
  const [entries, media] = await Promise.all([
    requestValue(entryStore.count()),
    requestValue(mediaStore.count()),
  ]);
  return { entries, media };
}

export async function syncOutbox(orgId: string): Promise<number> {
  if (!navigator.onLine) return 0;
  const objectStore = await store("readwrite", OUTBOX);
  const entries = await requestValue<SyncEntry[]>(objectStore.getAll());
  if (!entries.length) return 0;
  const response = await fetch("/api/scouting/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, entries }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Sync failed");
  const result = (await response.json()) as {
    acknowledgements: Array<{ clientId: string }>;
  };
  for (const acknowledgement of result.acknowledgements) {
    const deleteStore = await store("readwrite", OUTBOX);
    await requestValue(deleteStore.delete(acknowledgement.clientId));
  }
  return result.acknowledgements.length;
}

export async function syncMediaOutbox(orgId: string): Promise<number> {
  if (!navigator.onLine) return 0;
  const objectStore = await store("readwrite", MEDIA);
  const items = await requestValue<
    Array<{ clientId: string; metadata: Record<string, unknown>; blob: Blob }>
  >(objectStore.getAll());
  let synced = 0;
  for (const item of items) {
    const metadataResponse = await fetch("/api/scouting/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, clientId: item.clientId, ...item.metadata }),
    });
    if (!metadataResponse.ok) continue;
    const { uploadUrl } = (await metadataResponse.json()) as { uploadUrl: string };
    const upload = await fetch(uploadUrl, { method: "PUT", body: item.blob });
    if (!upload.ok) continue;
    const deleteStore = await store("readwrite", MEDIA);
    await requestValue(deleteStore.delete(item.clientId));
    synced += 1;
  }
  return synced;
}
