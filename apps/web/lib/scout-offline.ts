"use client";

import type { SyncEntry } from "@vantage/scouting";
import { partitionByOrgId, wouldCrossOrgLeak } from "@vantage/scouting";
import { lockScoutPayload } from "@vantage/scouting/identity";
import {
  decodeScoutQrContent,
  encodeScoutQrPayload,
  importedToSyncEntries,
  mergeOfflineHandoff,
  syncEntriesToQrRecords,
  type OfflineMergeResult,
  type ScoutQrRecord,
} from "@vantage/scouting/qr-handoff";
import { withSyncBackoff } from "./scouting/sync-backoff";

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
  // CD #4 — strip free-text scout identity keys before they land in IndexedDB.
  const locked: SyncEntry = { ...entry, payload: lockScoutPayload(entry.payload).payload };
  const objectStore = await store("readwrite", OUTBOX);
  await requestValue(objectStore.put(locked));
}

export async function queueMedia(input: {
  clientId: string;
  orgId: string;
  metadata: Record<string, unknown>;
  blob: Blob;
}): Promise<void> {
  if (!input.orgId) throw new Error("orgId is required to queue media");
  const objectStore = await store("readwrite", MEDIA);
  await requestValue(
    objectStore.put({
      clientId: input.clientId,
      orgId: input.orgId,
      metadata: { ...input.metadata, orgId: input.orgId },
      blob: input.blob,
    }),
  );
}

/** Queue a voice capture (audio blob + STT transcript) for bandwidth-safe sync when online. */
export async function queueVoiceCapture(input: {
  clientId: string;
  orgId: string;
  eventKey: string;
  teamKey: string;
  blob: Blob;
  transcript: string;
  fieldKey?: string | null;
  schemaId?: string | null;
  entryClientId?: string | null;
}): Promise<void> {
  if (!input.orgId) throw new Error("orgId is required to queue voice captures");
  const tags = ["voice", "stt"];
  if (input.fieldKey) tags.push(`field:${input.fieldKey}`);
  await queueMedia({
    clientId: input.clientId,
    orgId: input.orgId,
    metadata: {
      eventKey: input.eventKey,
      teamKey: input.teamKey,
      kind: "audio",
      contentType: input.blob.type || "audio/webm",
      byteSize: input.blob.size,
      transcript: input.transcript,
      schemaId: input.schemaId ?? undefined,
      entryClientId: input.entryClientId ?? undefined,
      fieldKey: input.fieldKey ?? undefined,
      tags,
    },
    blob: input.blob,
  });
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

type SyncValidation = {
  fieldKey: string;
  status: string;
  scoutValue: unknown;
  officialValue: unknown;
  officialSource: string;
  detail: string;
  soft?: boolean;
};

export type SyncOutboxResult = {
  count: number;
  validations: SyncValidation[];
  attempts: number;
};

async function syncOutboxOnce(orgId: string): Promise<Omit<SyncOutboxResult, "attempts">> {
  const objectStore = await store("readwrite", OUTBOX);
  const all = await requestValue<SyncEntry[]>(objectStore.getAll());
  const { allowed: entries } = partitionByOrgId(all, orgId);
  if (!entries.length) return { count: 0, validations: [] };
  const response = await fetch("/api/scouting/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, entries }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Sync failed (${response.status})`);
  }
  const result = (await response.json()) as {
    acknowledgements: Array<{
      clientId: string;
      validations?: SyncValidation[];
    }>;
  };
  const validations = result.acknowledgements.flatMap((ack) => ack.validations ?? []);
  for (const acknowledgement of result.acknowledgements) {
    const deleteStore = await store("readwrite", OUTBOX);
    await requestValue(deleteStore.delete(acknowledgement.clientId));
  }
  return { count: result.acknowledgements.length, validations };
}

/**
 * Push IndexedDB entry outbox with exponential backoff on flaky venue Wi-Fi.
 * Rows stay queued until the server acknowledges each clientId.
 */
export async function syncOutbox(
  orgId: string,
  options?: { signal?: AbortSignal; maxAttempts?: number; onRetry?: (n: number, delayMs: number) => void },
): Promise<SyncOutboxResult> {
  if (!navigator.onLine) return { count: 0, validations: [], attempts: 0 };
  let attempts = 0;
  const result = await withSyncBackoff(
    async () => {
      attempts += 1;
      return syncOutboxOnce(orgId);
    },
    {
      maxAttempts: options?.maxAttempts,
      signal: options?.signal,
      onRetry: (failure, delayMs) => options?.onRetry?.(failure, delayMs),
    },
  );
  return { ...result, attempts };
}

async function syncOneMedia(
  orgId: string,
  item: { clientId: string; orgId?: string; metadata: Record<string, unknown>; blob: Blob },
): Promise<boolean> {
  if (wouldCrossOrgLeak(item.orgId ?? (item.metadata.orgId as string | undefined), orgId)) {
    throw new Error("Organization access denied");
  }
  const metadataResponse = await fetch("/api/scouting/media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...item.metadata, orgId, clientId: item.clientId }),
  });
  if (!metadataResponse.ok) throw new Error("Media metadata upload failed");
  const { uploadUrl } = (await metadataResponse.json()) as { uploadUrl: string };
  const upload = await fetch(uploadUrl, { method: "PUT", body: item.blob });
  if (!upload.ok) throw new Error("Media blob upload failed");
  const deleteStore = await store("readwrite", MEDIA);
  await requestValue(deleteStore.delete(item.clientId));
  return true;
}

/** Upload queued pit media with per-item backoff; leaves failures queued. */
export async function syncMediaOutbox(
  orgId: string,
  options?: { signal?: AbortSignal; maxAttempts?: number },
): Promise<number> {
  if (!navigator.onLine) return 0;
  const objectStore = await store("readonly", MEDIA);
  const items = await requestValue<
    Array<{ clientId: string; orgId?: string; metadata: Record<string, unknown>; blob: Blob }>
  >(objectStore.getAll());
  const scoped = items.filter(
    (item) => !wouldCrossOrgLeak(item.orgId ?? (item.metadata.orgId as string | undefined), orgId),
  );
  let synced = 0;
  for (const item of scoped) {
    if (!navigator.onLine || options?.signal?.aborted) break;
    try {
      await withSyncBackoff(() => syncOneMedia(orgId, item), {
        maxAttempts: options?.maxAttempts ?? 3,
        signal: options?.signal,
      });
      synced += 1;
    } catch {
      /* leave item queued for a later reconnect */
    }
  }
  return synced;
}
