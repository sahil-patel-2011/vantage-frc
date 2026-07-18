"use client";

import type { SyncEntry } from "@vantage/scouting";
import {
  decodeScoutQrContent,
  encodeScoutQrPayload,
  importedToSyncEntries,
  mergeOfflineHandoff,
  syncEntriesToQrRecords,
  type OfflineMergeResult,
  type ScoutQrRecord,
} from "@vantage/scouting/qr-handoff";

const DB_NAME = "vantage-scouting";
const DB_VERSION = 2;
const OUTBOX = "entry-outbox";
const MEDIA = "media-outbox";
const CACHE = "event-cache";
const META = "meta";
const LAST_ORG_KEY = "lastOrgId";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: "clientId" });
      if (!db.objectStoreNames.contains(CACHE)) db.createObjectStore(CACHE, { keyPath: "orgId" });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
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

export async function rememberOrgId(orgId: string): Promise<void> {
  const objectStore = await store("readwrite", META);
  await requestValue(objectStore.put({ key: LAST_ORG_KEY, value: orgId }));
}

export async function getLastOrgId(): Promise<string | null> {
  const objectStore = await store("readonly", META);
  const row = await requestValue<{ value?: string } | undefined>(objectStore.get(LAST_ORG_KEY));
  if (typeof row?.value === "string" && row.value) return row.value;

  const cacheStore = await store("readonly", CACHE);
  const cached = await requestValue<Array<{ orgId: string }>>(cacheStore.getAll());
  const fallback = cached[0]?.orgId;
  if (fallback) {
    await rememberOrgId(fallback);
    return fallback;
  }
  return null;
}

export async function cacheEvent(orgId: string, data: unknown): Promise<void> {
  const objectStore = await store("readwrite", CACHE);
  await requestValue(objectStore.put({ orgId, data, cachedAt: new Date().toISOString() }));
  await rememberOrgId(orgId);
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

export async function listPendingEntries(): Promise<SyncEntry[]> {
  const objectStore = await store("readonly", OUTBOX);
  return requestValue<SyncEntry[]>(objectStore.getAll());
}

export async function replaceOutbox(entries: SyncEntry[]): Promise<void> {
  const objectStore = await store("readwrite", OUTBOX);
  await requestValue(objectStore.clear());
  for (const entry of entries) await requestValue(objectStore.put(entry));
}

export async function mergeRecordsIntoOutbox(input: {
  records: ScoutQrRecord[];
  schemaId: string;
  type: "match" | "pit";
}): Promise<OfflineMergeResult & { entries: SyncEntry[] }> {
  if (!input.records.length) throw new Error("QR payload did not contain scout entries");
  const incoming = importedToSyncEntries(input);
  const existing = await listPendingEntries();
  const merged = mergeOfflineHandoff(existing, incoming);
  await replaceOutbox(merged.queued);
  return { ...merged, entries: incoming };
}

export async function mergeQrHandoffIntoOutbox(input: {
  content: string;
  schemaId: string;
  type: "match" | "pit";
  orgId: string;
}): Promise<OfflineMergeResult & { entries: SyncEntry[]; mode: "embedded" | "handoff" | "json" }> {
  const decoded = decodeScoutQrContent(input.content);
  if (decoded.kind === "handoff") {
    if (!navigator.onLine) {
      throw new Error("Short-code handoff needs a network redeem. Ask for an embedded QR while offline.");
    }
    const response = await fetch(
      `/api/scouting/handoff?orgId=${encodeURIComponent(input.orgId)}&code=${encodeURIComponent(decoded.code)}`,
    );
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      records?: ScoutQrRecord[];
    };
    if (!response.ok) throw new Error(body.error ?? "Could not redeem handoff code");
    const merged = await mergeRecordsIntoOutbox({
      records: body.records ?? [],
      schemaId: input.schemaId,
      type: input.type,
    });
    return { ...merged, mode: "handoff" };
  }
  const merged = await mergeRecordsIntoOutbox({
    records: decoded.records,
    schemaId: input.schemaId,
    type: input.type,
  });
  return { ...merged, mode: decoded.kind };
}

export async function encodePendingQrPayload(filter?: { eventKey?: string }): Promise<string> {
  const pending = await listPendingEntries();
  const selected = pending.filter((entry) => !filter?.eventKey || entry.eventKey === filter.eventKey);
  return encodeScoutQrPayload(syncEntriesToQrRecords(selected));
}

export async function publishPendingShortCodeHandoff(
  orgId: string,
  filter?: { eventKey?: string },
): Promise<{ userCode: string; qrPayload: string; recordCount: number; verificationUri: string }> {
  const pending = await listPendingEntries();
  const selected = pending.filter((entry) => !filter?.eventKey || entry.eventKey === filter.eventKey);
  if (!selected.length) throw new Error("No pending outbox entries to hand off");
  const response = await fetch("/api/scouting/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, records: syncEntriesToQrRecords(selected) }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    userCode?: string;
    qrPayload?: string;
    recordCount?: number;
    verificationUri?: string;
  };
  if (!response.ok || !body.userCode || !body.qrPayload) {
    throw new Error(body.error ?? "Could not create handoff code");
  }
  return {
    userCode: body.userCode,
    qrPayload: body.qrPayload,
    recordCount: body.recordCount ?? selected.length,
    verificationUri: body.verificationUri ?? "",
  };
}

export async function syncOutbox(orgId: string): Promise<{
  count: number;
  validations: Array<{
    fieldKey: string;
    status: string;
    scoutValue: unknown;
    officialValue: unknown;
    officialSource: string;
    detail: string;
    soft?: boolean;
  }>;
}> {
  if (!navigator.onLine) return { count: 0, validations: [] };
  const objectStore = await store("readwrite", OUTBOX);
  const entries = await requestValue<SyncEntry[]>(objectStore.getAll());
  if (!entries.length) return { count: 0, validations: [] };
  const response = await fetch("/api/scouting/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, entries }),
  });
  if (!response.ok) throw new Error((await response.json()).error ?? "Sync failed");
  const result = (await response.json()) as {
    acknowledgements: Array<{
      clientId: string;
      validations?: Array<{
        fieldKey: string;
        status: string;
        scoutValue: unknown;
        officialValue: unknown;
        officialSource: string;
        detail: string;
        soft?: boolean;
      }>;
    }>;
  };
  const validations = result.acknowledgements.flatMap((ack) => ack.validations ?? []);
  for (const acknowledgement of result.acknowledgements) {
    const deleteStore = await store("readwrite", OUTBOX);
    await requestValue(deleteStore.delete(acknowledgement.clientId));
  }
  return { count: result.acknowledgements.length, validations };
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
