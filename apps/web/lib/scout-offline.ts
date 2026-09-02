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
import {
  exceedsMediaCap,
  formatByteSize,
  mediaKindLabel,
  oversizeMediaReason,
} from "./scouting/media-downscale";
import { withSyncBackoff } from "./scouting/sync-backoff";
import { evictScoutMedia, scoutMediaUrl } from "./scout-media/client";

const DB_NAME = "vantage-scouting";
// v3 adds the quarantine stores for entries/media the server permanently rejected.
// v4 adds the media-status store (synced / duplicate / failed per photo clientId).
const DB_VERSION = 4;
const OUTBOX = "entry-outbox";
const MEDIA = "media-outbox";
const ENTRY_QUARANTINE = "entry-quarantine";
const MEDIA_QUARANTINE = "media-quarantine";
const MEDIA_STATUS = "media-status";
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
      if (!db.objectStoreNames.contains(ENTRY_QUARANTINE)) {
        db.createObjectStore(ENTRY_QUARANTINE, { keyPath: "clientId" });
      }
      if (!db.objectStoreNames.contains(MEDIA_QUARANTINE)) {
        db.createObjectStore(MEDIA_QUARANTINE, { keyPath: "clientId" });
      }
      if (!db.objectStoreNames.contains(MEDIA_STATUS)) {
        db.createObjectStore(MEDIA_STATUS, { keyPath: "clientId" });
      }
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
  /** `entryClientId` links the photo to its offline entry before either has synced. */
  metadata: Record<string, unknown> & { entryClientId?: string | null };
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
  // A re-queued clientId starts fresh: forget any previous synced/failed verdict.
  await clearMediaStatus(input.clientId);
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

export async function pendingCounts(): Promise<{
  entries: number;
  media: number;
  quarantined: number;
}> {
  const [entryStore, mediaStore, entryQuarantine, mediaQuarantine] = await Promise.all([
    store("readonly", OUTBOX),
    store("readonly", MEDIA),
    store("readonly", ENTRY_QUARANTINE),
    store("readonly", MEDIA_QUARANTINE),
  ]);
  const [entries, media, quarantinedEntries, quarantinedMedia] = await Promise.all([
    requestValue(entryStore.count()),
    requestValue(mediaStore.count()),
    requestValue(entryQuarantine.count()),
    requestValue(mediaQuarantine.count()),
  ]);
  return { entries, media, quarantined: quarantinedEntries + quarantinedMedia };
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
  /** Entries the server permanently rejected this pass — moved to quarantine. */
  quarantined: number;
};

type MediaOutboxItem = {
  clientId: string;
  orgId?: string;
  metadata: Record<string, unknown>;
  blob: Blob;
};

export type QuarantinedEntry = {
  kind: "entry";
  clientId: string;
  orgId: string | null;
  reason: string;
  quarantinedAt: string;
  entry: SyncEntry;
};

export type QuarantinedMedia = {
  kind: "media";
  clientId: string;
  orgId: string | null;
  reason: string;
  quarantinedAt: string;
  metadata: Record<string, unknown>;
  blob: Blob;
};

export type QuarantinedItem = QuarantinedEntry | QuarantinedMedia;

/**
 * Move a permanently rejected entry out of the sync loop so the rest of the
 * outbox keeps flowing. Nothing is deleted — the scout decides Retry/Discard.
 */
export async function quarantineEntry(entry: SyncEntry, reason: string): Promise<void> {
  const quarantineStore = await store("readwrite", ENTRY_QUARANTINE);
  await requestValue(
    quarantineStore.put({
      kind: "entry",
      clientId: entry.clientId,
      orgId: entry.orgId ?? null,
      reason,
      quarantinedAt: new Date().toISOString(),
      entry,
    } satisfies QuarantinedEntry),
  );
  const outbox = await store("readwrite", OUTBOX);
  await requestValue(outbox.delete(entry.clientId));
}

export async function quarantineMedia(item: MediaOutboxItem, reason: string): Promise<void> {
  const orgId = item.orgId ?? ((item.metadata.orgId as string | undefined) ?? null);
  const quarantineStore = await store("readwrite", MEDIA_QUARANTINE);
  await requestValue(
    quarantineStore.put({
      kind: "media",
      clientId: item.clientId,
      orgId,
      reason,
      quarantinedAt: new Date().toISOString(),
      metadata: item.metadata,
      blob: item.blob,
    } satisfies QuarantinedMedia),
  );
  const mediaStore = await store("readwrite", MEDIA);
  await requestValue(mediaStore.delete(item.clientId));
  await recordMediaStatus({
    clientId: item.clientId,
    orgId,
    status: "failed",
    detail: reason,
    duplicateOf: null,
    eventKey: typeof item.metadata.eventKey === "string" ? item.metadata.eventKey : null,
    teamKey: typeof item.metadata.teamKey === "string" ? item.metadata.teamKey : null,
  });
}

/** Everything needing attention, oldest first. Scoped to one org when given. */
export async function listQuarantine(orgId?: string): Promise<QuarantinedItem[]> {
  const [entryStore, mediaStore] = await Promise.all([
    store("readonly", ENTRY_QUARANTINE),
    store("readonly", MEDIA_QUARANTINE),
  ]);
  const [entries, media] = await Promise.all([
    requestValue<QuarantinedEntry[]>(entryStore.getAll()),
    requestValue<QuarantinedMedia[]>(mediaStore.getAll()),
  ]);
  const all: QuarantinedItem[] = [...entries, ...media];
  const scoped = orgId ? all.filter((item) => item.orgId === orgId) : all;
  return scoped.sort((a, b) => a.quarantinedAt.localeCompare(b.quarantinedAt));
}

/** Put a quarantined item back into its outbox for the next sync pass. */
export async function retryQuarantined(clientId: string): Promise<boolean> {
  const entryStore = await store("readonly", ENTRY_QUARANTINE);
  const entryRow = await requestValue<QuarantinedEntry | undefined>(entryStore.get(clientId));
  if (entryRow) {
    const outbox = await store("readwrite", OUTBOX);
    await requestValue(outbox.put(entryRow.entry));
    const cleanup = await store("readwrite", ENTRY_QUARANTINE);
    await requestValue(cleanup.delete(clientId));
    return true;
  }
  const mediaStore = await store("readonly", MEDIA_QUARANTINE);
  const mediaRow = await requestValue<QuarantinedMedia | undefined>(mediaStore.get(clientId));
  if (mediaRow) {
    const media = await store("readwrite", MEDIA);
    await requestValue(
      media.put({
        clientId: mediaRow.clientId,
        orgId: mediaRow.orgId ?? undefined,
        metadata: mediaRow.metadata,
        blob: mediaRow.blob,
      }),
    );
    const cleanup = await store("readwrite", MEDIA_QUARANTINE);
    await requestValue(cleanup.delete(clientId));
    return true;
  }
  return false;
}

/** Drop a quarantined item for good — explicit scout decision only. */
export async function discardQuarantined(clientId: string): Promise<void> {
  const entryStore = await store("readwrite", ENTRY_QUARANTINE);
  await requestValue(entryStore.delete(clientId));
  const mediaStore = await store("readwrite", MEDIA_QUARANTINE);
  await requestValue(mediaStore.delete(clientId));
  await clearMediaStatus(clientId);
}

/* ---------------------------------------------------------------------------
 * Per-photo sync verdicts. The outbox row disappears once a photo is
 * acknowledged, so the form needs a small durable record to keep showing
 * "synced" / "duplicate of …" / "failed" chips after a reload.
 * ------------------------------------------------------------------------- */

export type MediaSyncPhase = "queued" | "uploading" | "synced" | "duplicate" | "failed" | "unknown";

export type MediaStatusRecord = {
  clientId: string;
  orgId: string | null;
  status: "synced" | "duplicate" | "failed";
  detail: string | null;
  /** For duplicates: the clientId of the photo the server already had. */
  duplicateOf: string | null;
  eventKey: string | null;
  teamKey: string | null;
  updatedAt: string;
};

export type MediaSyncDescription = {
  phase: MediaSyncPhase;
  detail: string | null;
  duplicateOf: string | null;
};

/** clientIds whose PUT is in flight right now (memory only — resets on reload). */
const inFlightMedia = new Set<string>();

async function recordMediaStatus(record: Omit<MediaStatusRecord, "updatedAt">): Promise<void> {
  const statusStore = await store("readwrite", MEDIA_STATUS);
  await requestValue(
    statusStore.put({ ...record, updatedAt: new Date().toISOString() } satisfies MediaStatusRecord),
  );
}

export async function getMediaStatus(clientId: string): Promise<MediaStatusRecord | null> {
  const statusStore = await store("readonly", MEDIA_STATUS);
  const row = await requestValue<MediaStatusRecord | undefined>(statusStore.get(clientId));
  return row ?? null;
}

export async function listMediaStatuses(orgId?: string): Promise<MediaStatusRecord[]> {
  const statusStore = await store("readonly", MEDIA_STATUS);
  const rows = await requestValue<MediaStatusRecord[]>(statusStore.getAll());
  return orgId ? rows.filter((row) => row.orgId === orgId) : rows;
}

export async function clearMediaStatus(clientId: string): Promise<void> {
  const statusStore = await store("readwrite", MEDIA_STATUS);
  await requestValue(statusStore.delete(clientId));
}

/** Where a captured photo is in its life: outbox → in flight → synced / duplicate / failed. */
export async function describeMediaSync(clientId: string): Promise<MediaSyncDescription> {
  if (inFlightMedia.has(clientId)) return { phase: "uploading", detail: null, duplicateOf: null };
  const mediaStore = await store("readonly", MEDIA);
  const queued = await requestValue<MediaOutboxItem | undefined>(mediaStore.get(clientId));
  if (queued) return { phase: "queued", detail: null, duplicateOf: null };
  const quarantineStore = await store("readonly", MEDIA_QUARANTINE);
  const quarantined = await requestValue<QuarantinedMedia | undefined>(quarantineStore.get(clientId));
  if (quarantined) return { phase: "failed", detail: quarantined.reason, duplicateOf: null };
  const status = await getMediaStatus(clientId);
  if (status) return { phase: status.status, detail: status.detail, duplicateOf: status.duplicateOf };
  return { phase: "unknown", detail: null, duplicateOf: null };
}

/** The clientId the server actually holds — a duplicate resolves to the original. */
export async function resolveMediaRef(clientId: string): Promise<string> {
  const status = await getMediaStatus(clientId).catch(() => null);
  return status?.status === "duplicate" && status.duplicateOf ? status.duplicateOf : clientId;
}

/** Discard a photo that has not synced (queued or quarantined) — explicit scout decision. */
export async function discardQueuedMedia(clientId: string): Promise<void> {
  const mediaStore = await store("readwrite", MEDIA);
  await requestValue(mediaStore.delete(clientId));
  const quarantineStore = await store("readwrite", MEDIA_QUARANTINE);
  await requestValue(quarantineStore.delete(clientId));
  await clearMediaStatus(clientId);
}

/**
 * Soft-delete a synced photo on the server (own photo, or owner/admin), then
 * forget it locally and evict it from the service-worker media cache so it
 * cannot resurface on a shared tablet.
 */
export async function deleteSyncedMedia(orgId: string, clientId: string): Promise<void> {
  if (!orgId) throw new Error("orgId is required to delete media");
  const response = await fetch(scoutMediaUrl(orgId, clientId), { method: "DELETE" });
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Could not delete photo (${response.status})`);
  }
  await discardQueuedMedia(clientId);
  await evictScoutMedia([scoutMediaUrl(orgId, clientId), scoutMediaUrl(orgId, clientId, "thumb")]);
}

/**
 * Read a queued (or quarantined) media blob so the UI can preview photos
 * offline via URL.createObjectURL before they ever reach the server.
 */
export async function getQueuedMediaBlob(clientId: string): Promise<Blob | null> {
  const mediaStore = await store("readonly", MEDIA);
  const row = await requestValue<MediaOutboxItem | undefined>(mediaStore.get(clientId));
  if (row?.blob) return row.blob;
  const quarantineStore = await store("readonly", MEDIA_QUARANTINE);
  const quarantined = await requestValue<QuarantinedMedia | undefined>(
    quarantineStore.get(clientId),
  );
  return quarantined?.blob ?? null;
}

/** A weekend outbox syncs in slices this size so no batch trips server caps. */
export const SYNC_BATCH_SIZE = 50;

/** Pure batching helper (tested): slices preserve order, last may be short. */
export function sliceIntoBatches<T>(items: T[], size: number = SYNC_BATCH_SIZE): T[][] {
  if (!Number.isFinite(size) || size < 1) size = SYNC_BATCH_SIZE;
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

export type SyncBatchOutcome = {
  acknowledgements: Array<{ clientId: string; validations?: SyncValidation[] }>;
  rejected: Array<{ clientId: string; reason: string }>;
};

/**
 * Pure response parser (tested). Feature-detects servers: per-entry servers
 * return { acknowledgements, rejected }; an older deployment returns only
 * { acknowledgements } and rejections simply stay queued for a later pass.
 */
export function parseSyncResponseBody(body: unknown): SyncBatchOutcome {
  const record = (body ?? {}) as {
    acknowledgements?: Array<{ clientId?: unknown; validations?: SyncValidation[] }>;
    rejected?: Array<{ clientId?: unknown; reason?: unknown }>;
  };
  const acknowledgements = (Array.isArray(record.acknowledgements) ? record.acknowledgements : [])
    .filter((ack): ack is { clientId: string; validations?: SyncValidation[] } =>
      typeof ack?.clientId === "string" && ack.clientId.length > 0,
    );
  const rejected = (Array.isArray(record.rejected) ? record.rejected : [])
    .filter((row) => typeof row?.clientId === "string" && row.clientId.length > 0)
    .map((row) => ({
      clientId: row.clientId as string,
      reason:
        typeof row.reason === "string" && row.reason.trim()
          ? row.reason
          : "Server rejected this entry",
    }));
  return { acknowledgements, rejected };
}

async function pushEntryBatch(orgId: string, batch: SyncEntry[]): Promise<SyncBatchOutcome> {
  const response = await fetch("/api/scouting/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, entries: batch, resultsMode: "per-entry" }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Sync failed (${response.status})`);
  }
  return parseSyncResponseBody(await response.json().catch(() => ({})));
}

async function syncOutboxOnce(orgId: string): Promise<Omit<SyncOutboxResult, "attempts">> {
  const objectStore = await store("readonly", OUTBOX);
  const all = await requestValue<SyncEntry[]>(objectStore.getAll());
  const { allowed: entries } = partitionByOrgId(all, orgId);
  if (!entries.length) return { count: 0, validations: [], quarantined: 0 };
  let count = 0;
  let quarantined = 0;
  const validations: SyncValidation[] = [];
  for (const batch of sliceIntoBatches(entries)) {
    const outcome = await pushEntryBatch(orgId, batch);
    for (const acknowledgement of outcome.acknowledgements) {
      validations.push(...(acknowledgement.validations ?? []));
      const deleteStore = await store("readwrite", OUTBOX);
      await requestValue(deleteStore.delete(acknowledgement.clientId));
      count += 1;
    }
    for (const rejection of outcome.rejected) {
      const entry = batch.find((candidate) => candidate.clientId === rejection.clientId);
      if (!entry) continue;
      await quarantineEntry(entry, rejection.reason);
      quarantined += 1;
    }
  }
  return { count, validations, quarantined };
}

/**
 * Push IndexedDB entry outbox with exponential backoff on flaky venue Wi-Fi.
 * Rows stay queued until the server acknowledges each clientId.
 */
export async function syncOutbox(
  orgId: string,
  options?: { signal?: AbortSignal; maxAttempts?: number; onRetry?: (n: number, delayMs: number) => void },
): Promise<SyncOutboxResult> {
  if (!navigator.onLine) return { count: 0, validations: [], attempts: 0, quarantined: 0 };
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

/** A server 4xx that will never succeed on retry — quarantine, don't loop. */
class PermanentMediaRejection extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentMediaRejection";
  }
}

/**
 * 400 malformed · 410 deleted on the server · 413 over cap · 415 not an image ·
 * 422 rejected · 507 team quota full — none of these change on a retry loop.
 * (507 clears once someone deletes old photos; the quarantine Retry covers that.)
 */
export function isPermanentMediaStatus(status: number): boolean {
  return (
    status === 400 ||
    status === 410 ||
    status === 413 ||
    status === 415 ||
    status === 422 ||
    status === 507
  );
}

type MediaUploadReceipt = {
  ok?: boolean;
  duplicate?: boolean;
  clientId?: string;
};

async function syncOneMedia(orgId: string, item: MediaOutboxItem): Promise<boolean> {
  if (wouldCrossOrgLeak(item.orgId ?? (item.metadata.orgId as string | undefined), orgId)) {
    throw new Error("Organization access denied");
  }
  const eventKey = typeof item.metadata.eventKey === "string" ? item.metadata.eventKey : null;
  const teamKey = typeof item.metadata.teamKey === "string" ? item.metadata.teamKey : null;
  inFlightMedia.add(item.clientId);
  try {
    const metadataResponse = await fetch("/api/scouting/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item.metadata, orgId, clientId: item.clientId }),
    });
    if (!metadataResponse.ok) {
      const body = (await metadataResponse.json().catch(() => ({}))) as { error?: string };
      const message = body.error ?? `Media metadata upload failed (${metadataResponse.status})`;
      if (isPermanentMediaStatus(metadataResponse.status)) {
        throw new PermanentMediaRejection(message);
      }
      throw new Error(message);
    }
    const prepared = (await metadataResponse.json()) as {
      uploadUrl: string;
      alreadyUploaded?: boolean;
      deleted?: boolean;
    };
    if (prepared.deleted) {
      throw new PermanentMediaRejection("This photo was deleted from the team's pit media");
    }
    let receipt: MediaUploadReceipt = { ok: true, duplicate: false };
    if (!prepared.alreadyUploaded) {
      const upload = await fetch(prepared.uploadUrl, { method: "PUT", body: item.blob });
      if (!upload.ok) {
        const body = (await upload.json().catch(() => ({}))) as { error?: string };
        const message =
          body.error ??
          `Media blob upload failed (${upload.status}, file is ${formatByteSize(item.blob.size)})`;
        if (isPermanentMediaStatus(upload.status)) throw new PermanentMediaRejection(message);
        throw new Error(message);
      }
      receipt = (await upload.json().catch(() => ({ ok: true }))) as MediaUploadReceipt;
    }
    const deleteStore = await store("readwrite", MEDIA);
    await requestValue(deleteStore.delete(item.clientId));
    const duplicateOf =
      receipt.duplicate && receipt.clientId && receipt.clientId !== item.clientId
        ? receipt.clientId
        : null;
    await recordMediaStatus({
      clientId: item.clientId,
      orgId,
      status: duplicateOf ? "duplicate" : "synced",
      detail: duplicateOf ? "Identical photo already on the team wall — kept the original." : null,
      duplicateOf,
      eventKey,
      teamKey,
    });
    return true;
  } finally {
    inFlightMedia.delete(item.clientId);
  }
}

export type SyncMediaResult = { synced: number; quarantined: number };

/**
 * Upload queued pit media with per-item backoff. Transient failures stay
 * queued for the next reconnect; over-cap files and permanent server
 * rejections move to quarantine so the pending count actually drains.
 */
export async function syncMediaOutbox(
  orgId: string,
  options?: { signal?: AbortSignal; maxAttempts?: number },
): Promise<SyncMediaResult> {
  if (!navigator.onLine) return { synced: 0, quarantined: 0 };
  const objectStore = await store("readonly", MEDIA);
  const items = await requestValue<MediaOutboxItem[]>(objectStore.getAll());
  const scoped = items.filter(
    (item) => !wouldCrossOrgLeak(item.orgId ?? (item.metadata.orgId as string | undefined), orgId),
  );
  let synced = 0;
  let quarantined = 0;
  for (const item of scoped) {
    if (!navigator.onLine || options?.signal?.aborted) break;
    if (exceedsMediaCap(item.blob.size)) {
      await quarantineMedia(
        item,
        oversizeMediaReason(item.blob.size, mediaKindLabel(item.metadata.kind)),
      );
      quarantined += 1;
      continue;
    }
    let permanent: PermanentMediaRejection | null = null;
    try {
      await withSyncBackoff(
        async () => {
          try {
            return await syncOneMedia(orgId, item);
          } catch (error) {
            if (error instanceof PermanentMediaRejection) {
              // Abort the backoff loop immediately — retrying a 4xx cannot help.
              permanent = error;
              throw new DOMException("Aborted", "AbortError");
            }
            throw error;
          }
        },
        {
          maxAttempts: options?.maxAttempts ?? 3,
          signal: options?.signal,
        },
      );
      synced += 1;
    } catch {
      if (permanent !== null) {
        await quarantineMedia(item, (permanent as PermanentMediaRejection).message);
        quarantined += 1;
      }
      /* transient failure — leave item queued for a later reconnect */
    }
  }
  return { synced, quarantined };
}
