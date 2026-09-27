"use client";

import { MEDIA_PAUSED_MESSAGE } from "./media-availability";
import type { SyncEntry } from "@vantage/scouting";
import { partitionByOrgId } from "@vantage/scouting";
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
  drainOutboxChunks,
  parseOutboxChunkBody,
  type OutboxChunkOutcome,
} from "./scouting/outbox-chunk";
import { withSyncBackoff } from "./scouting/sync-backoff";
import { assertScoutStorageUser, idbValue, requireScoutStorageUser, scoutStorageUser, scoutTransaction } from "./scouting/personal-store";
import { finishScoutQrTransfer, receiveScoutQrPart } from "./scouting/qr-transfer-store";

export {
  OUTBOX_CHUNK_SIZE as SYNC_BATCH_SIZE,
  chunkOutbox as sliceIntoBatches,
  parseOutboxChunkBody as parseSyncResponseBody,
} from "./scouting/outbox-chunk";

const OUTBOX = "entry-outbox";
const ENTRY_QUARANTINE = "entry-quarantine";
const CACHE = "event-cache";
const META = "meta";
const LAST_ORG_KEY = "lastOrgId";

export function stableClientId(): string { return crypto.randomUUID(); }

export async function queueEntry(entry: SyncEntry): Promise<void> {
  if (!entry.orgId) throw new Error("Choose your team before saving scouting.");
  const user = await requireScoutStorageUser(entry.orgId);
  const locked: SyncEntry = { ...entry, payload: lockScoutPayload(entry.payload).payload };
  await assertScoutStorageUser(user, entry.orgId);
  await scoutTransaction(user, OUTBOX, "readwrite", async tx => {
    await idbValue(tx.objectStore(OUTBOX).put(locked));
  });
}

// Archived media remains in the legacy database; removed uploads cannot be restarted.
export async function queueMedia(_input: {
  clientId: string; orgId: string; metadata: Record<string, unknown>; blob: Blob;
}): Promise<void> { throw new Error(MEDIA_PAUSED_MESSAGE); }

export async function queueVoiceCapture(_input: {
  clientId: string; orgId: string; eventKey: string; teamKey: string; blob: Blob;
  transcript: string; fieldKey?: string | null; schemaId?: string | null; entryClientId?: string | null;
}): Promise<void> { throw new Error(MEDIA_PAUSED_MESSAGE); }

export async function rememberOrgId(orgId: string): Promise<void> {
  const user = await requireScoutStorageUser(orgId);
  await scoutTransaction(user, META, "readwrite", async tx => {
    await idbValue(tx.objectStore(META).put({ key: LAST_ORG_KEY, value: orgId }));
  });
}

export async function getLastOrgId(): Promise<string | null> {
  const user = await scoutStorageUser();
  if (!user) return null;
  const row = await scoutTransaction(user, META, "readonly", tx =>
    idbValue<{ value?: string } | undefined>(tx.objectStore(META).get(LAST_ORG_KEY)));
  await assertScoutStorageUser(user);
  return typeof row?.value === "string" ? row.value : null;
}

export async function cacheEvent(orgId: string, data: unknown): Promise<void> {
  const user = await requireScoutStorageUser(orgId);
  await scoutTransaction(user, [CACHE, META], "readwrite", async tx => {
    await Promise.all([
      idbValue(tx.objectStore(CACHE).put({ orgId, data, cachedAt: new Date().toISOString() })),
      idbValue(tx.objectStore(META).put({ key: LAST_ORG_KEY, value: orgId })),
    ]);
  });
}

export async function getCachedEvent<T>(orgId: string): Promise<T | null> {
  const user = await scoutStorageUser(orgId);
  if (!user) return null;
  const row = await scoutTransaction(user, CACHE, "readonly", tx =>
    idbValue<{ data: T } | undefined>(tx.objectStore(CACHE).get(orgId)));
  await assertScoutStorageUser(user, orgId);
  return row?.data ?? null;
}

async function entriesFor(user: string, orgId?: string): Promise<SyncEntry[]> {
  const rows = await scoutTransaction(user, OUTBOX, "readonly", tx =>
    idbValue<SyncEntry[]>(tx.objectStore(OUTBOX).getAll()));
  return orgId ? rows.filter(row => row.orgId === orgId) : rows;
}

export async function pendingCounts(orgId?: string): Promise<{ entries: number; media: number; quarantined: number }> {
  const user = await scoutStorageUser(orgId);
  if (!user) return { entries: 0, media: 0, quarantined: 0 };
  const [entries, rejected] = await scoutTransaction(user, [OUTBOX, ENTRY_QUARANTINE], "readonly", tx =>
    Promise.all([
      idbValue<SyncEntry[]>(tx.objectStore(OUTBOX).getAll()),
      idbValue<QuarantinedEntry[]>(tx.objectStore(ENTRY_QUARANTINE).getAll()),
    ]));
  await assertScoutStorageUser(user, orgId);
  return {
    entries: entries.filter(row => !orgId || row.orgId === orgId).length,
    media: 0,
    quarantined: rejected.filter(row => !orgId || row.orgId === orgId).length,
  };
}

export async function listPendingEntries(orgId?: string): Promise<SyncEntry[]> {
  const user = await scoutStorageUser(orgId);
  if (!user) return [];
  const rows = await entriesFor(user, orgId);
  await assertScoutStorageUser(user, orgId);
  return rows;
}

export async function replaceOutbox(entries: SyncEntry[], orgId?: string): Promise<void> {
  const user = await requireScoutStorageUser(orgId);
  await replacePersonalOutbox(user, entries, orgId);
}

async function replacePersonalOutbox(user: string, entries: SyncEntry[], orgId?: string): Promise<void> {
  await assertScoutStorageUser(user, orgId);
  if (entries.some(entry => !entry.orgId || (orgId && entry.orgId !== orgId))) throw new Error("Organization access denied");
  await scoutTransaction(user, OUTBOX, "readwrite", async tx => {
    const outbox = tx.objectStore(OUTBOX);
    const previous = await idbValue<SyncEntry[]>(outbox.getAll());
    for (const entry of previous) if (!orgId || entry.orgId === orgId) outbox.delete(entry.clientId);
    for (const entry of entries) outbox.put({ ...entry, payload: lockScoutPayload(entry.payload).payload });
  });
}

export async function mergeRecordsIntoOutbox(input: {
  records: ScoutQrRecord[];
  schemaId: string;
  type: "match" | "pit";
  /** The team this phone syncs for. Rows without it were never sent. */
  orgId: string;
}): Promise<OfflineMergeResult & { entries: SyncEntry[] }> {
  if (!input.records.length) throw new Error("That code had no scouting in it.");
  if (!input.orgId) throw new Error("Choose your team before taking a teammate's matches.");
  const incoming = importedToSyncEntries(input);
  const user = await requireScoutStorageUser(input.orgId);
  await assertScoutStorageUser(user, input.orgId);
  const merged = await scoutTransaction(user, OUTBOX, "readwrite", async tx => {
    const outbox = tx.objectStore(OUTBOX);
    const all = await idbValue<SyncEntry[]>(outbox.getAll());
    const current = all.filter(entry => entry.orgId === input.orgId);
    const result = mergeOfflineHandoff(current, incoming);
    for (const entry of result.queued) outbox.put(entry);
    return result;
  });
  return { ...merged, entries: incoming };
}

export async function mergeQrHandoffIntoOutbox(input: {
  content: string;
  schemaId: string;
  type: "match" | "pit";
  orgId: string;
}): Promise<OfflineMergeResult & { entries: SyncEntry[]; mode: "embedded" | "handoff" | "json" | "partial"; transfer?: { received: number; total: number } }> {
  const transfer = await receiveScoutQrPart(input.content, input.orgId);
  if (transfer.content === null) return { queued: [], accepted: 0, replaced: 0, ignored: 0, entries: [], mode: "partial",
    transfer: { received: transfer.received, total: transfer.total } };
  const decoded = decodeScoutQrContent(transfer.content);
  if (decoded.kind === "handoff") {
    if (!navigator.onLine) {
      throw new Error("A typed code needs signal. With no signal, scan your teammate's QR code instead.");
    }
    const response = await fetch(
      `/api/scouting/handoff?orgId=${encodeURIComponent(input.orgId)}&code=${encodeURIComponent(decoded.code)}`,
    );
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      records?: ScoutQrRecord[];
    };
    if (!response.ok) throw new Error(body.error ?? "That code didn't work. Check the 8 letters, or scan the QR code.");
    const merged = await mergeRecordsIntoOutbox({
      records: body.records ?? [],
      schemaId: input.schemaId,
      type: input.type,
      orgId: input.orgId,
    });
    return { ...merged, mode: "handoff" };
  }
  const merged = await mergeRecordsIntoOutbox({
    records: decoded.records,
    schemaId: input.schemaId,
    type: input.type,
    orgId: input.orgId,
  });
  if (transfer.transferId) await finishScoutQrTransfer(input.orgId, transfer.transferId);
  return { ...merged, mode: decoded.kind };
}

export async function encodePendingQrPayload(filter?: { eventKey?: string; orgId?: string }): Promise<string> {
  const pending = await listPendingEntries(filter?.orgId);
  const selected = pending.filter((entry) => !filter?.eventKey || entry.eventKey === filter.eventKey);
  return encodeScoutQrPayload(syncEntriesToQrRecords(selected));
}

export async function publishPendingShortCodeHandoff(
  orgId: string,
  filter?: { eventKey?: string; orgId?: string },
): Promise<{ userCode: string; qrPayload: string; recordCount: number; verificationUri: string }> {
  const user = await requireScoutStorageUser(orgId);
  const pending = await entriesFor(user, orgId);
  const selected = pending.filter((entry) => !filter?.eventKey || entry.eventKey === filter.eventKey);
  if (!selected.length) throw new Error("No pending outbox entries to hand off");
  await assertScoutStorageUser(user, orgId);
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
export async function quarantineEntry(entry: SyncEntry, reason: string): Promise<boolean> {
  const user = await requireScoutStorageUser(entry.orgId);
  return quarantinePersonalEntry(user, entry, reason);
}

async function quarantinePersonalEntry(user: string, entry: SyncEntry, reason: string): Promise<boolean> {
  await assertScoutStorageUser(user, entry.orgId);
  return scoutTransaction(user, [OUTBOX, ENTRY_QUARANTINE], "readwrite", async tx => {
    const outbox = tx.objectStore(OUTBOX);
    const current = await idbValue<SyncEntry | undefined>(outbox.get(entry.clientId));
    if (!current || !sameOutboxVersion(current, entry)) return false;
    tx.objectStore(ENTRY_QUARANTINE).put({
      kind: "entry", clientId: entry.clientId, orgId: entry.orgId ?? null,
      reason, quarantinedAt: new Date().toISOString(), entry,
    } satisfies QuarantinedEntry);
    outbox.delete(entry.clientId);
    return true;
  });
}

/** Same saved version of an entry: what was sent is still what is queued. */
export function sameOutboxVersion(
  a: Pick<SyncEntry, "updatedAt" | "payload">,
  b: Pick<SyncEntry, "updatedAt" | "payload">,
): boolean {
  return a.updatedAt === b.updatedAt && JSON.stringify(a.payload) === JSON.stringify(b.payload);
}

/** Acknowledgements remove only the version actually sent, in its original person's database. */
async function removeIfUnchanged(user: string, sent: SyncEntry): Promise<boolean> {
  await assertScoutStorageUser(user, sent.orgId);
  return scoutTransaction(user, OUTBOX, "readwrite", async tx => {
    const outbox = tx.objectStore(OUTBOX);
    const current = await idbValue<SyncEntry | undefined>(outbox.get(sent.clientId));
    const unchanged = !current || sameOutboxVersion(current, sent);
    if (current && unchanged) outbox.delete(sent.clientId);
    return unchanged;
  });
}

export async function quarantineMedia(_item: { clientId: string; orgId?: string; metadata: Record<string, unknown>; blob: Blob }, _reason: string): Promise<void> {
  throw new Error(MEDIA_PAUSED_MESSAGE);
}

export async function listQuarantine(orgId?: string): Promise<QuarantinedItem[]> {
  const user = await scoutStorageUser(orgId);
  if (!user) return [];
  const rows = await scoutTransaction(user, ENTRY_QUARANTINE, "readonly", tx =>
    idbValue<QuarantinedEntry[]>(tx.objectStore(ENTRY_QUARANTINE).getAll()));
  await assertScoutStorageUser(user, orgId);
  return rows.filter(row => !orgId || row.orgId === orgId).sort((a, b) => a.quarantinedAt.localeCompare(b.quarantinedAt));
}

export async function retryQuarantined(clientId: string): Promise<boolean> {
  const user = await scoutStorageUser();
  if (!user) return false;
  return scoutTransaction(user, [OUTBOX, ENTRY_QUARANTINE], "readwrite", async tx => {
    const rejected = tx.objectStore(ENTRY_QUARANTINE);
    const row = await idbValue<QuarantinedEntry | undefined>(rejected.get(clientId));
    if (!row) return false;
    const current = await idbValue<SyncEntry | undefined>(tx.objectStore(OUTBOX).get(clientId));
    // Do not overwrite a corrected entry already queued while the attention panel was open.
    if (!current) tx.objectStore(OUTBOX).put(row.entry);
    rejected.delete(clientId);
    return true;
  });
}

export async function discardQuarantined(clientId: string): Promise<void> {
  const user = await scoutStorageUser();
  if (!user) return;
  await scoutTransaction(user, ENTRY_QUARANTINE, "readwrite", async tx => {
    await idbValue(tx.objectStore(ENTRY_QUARANTINE).delete(clientId));
  });
}

export async function getQueuedMediaBlob(_clientId: string): Promise<Blob | null> { return null; }

export type SyncBatchOutcome = OutboxChunkOutcome;

async function pushEntryBatch(user: string, orgId: string, batch: SyncEntry[]): Promise<OutboxChunkOutcome> {
  await assertScoutStorageUser(user, orgId);
  const response = await fetch("/api/scouting/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orgId, entries: batch, resultsMode: "per-entry" }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Couldn't sync yet. It will retry when you're back online.");
  }
  return parseOutboxChunkBody(await response.json().catch(() => ({})));
}

/**
 * One drain at a time. The scouting page and the app frame's outbox pill both drain when signal
 * returns; running together they sent the same entry twice and the second came back "rejected"
 * for an entry that had been saved. A second caller in this tab joins the drain in flight, and
 * navigator.locks keeps two tabs of the app from draining at once.
 */
const drains = new Map<string, Promise<Omit<SyncOutboxResult, "attempts">>>();

async function syncOutboxOnce(orgId: string): Promise<Omit<SyncOutboxResult, "attempts">> {
  const user = await requireScoutStorageUser(orgId);
  const key = `${user}:${orgId}`;
  const active = drains.get(key);
  if (active) return active;
  const run = () => drainOutboxNow(user, orgId);
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  const drain = (locks ? locks.request(`vantage-scout-outbox:${key}`, run) : run()).finally(() => drains.delete(key));
  drains.set(key, drain);
  return drain;
}

async function drainOutboxNow(user: string, orgId: string): Promise<Omit<SyncOutboxResult, "attempts">> {
  const validations: SyncValidation[] = [];
  let count = 0;
  let quarantined = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    await assertScoutStorageUser(user, orgId);
    const all = await entriesFor(user, orgId);
    const { allowed: entries } = partitionByOrgId(all, orgId);
    if (!entries.length) break;
    const drain = await drainOutboxChunks(entries, batch => pushEntryBatch(user, orgId, batch));
    let changedDuringUpload = false;
    for (const { entry, acknowledgement } of drain.accepted) {
      validations.push(...((acknowledgement.validations ?? []) as SyncValidation[]));
      if (await removeIfUnchanged(user, entry)) count += 1;
      else changedDuringUpload = true;
    }
    for (const { entry, reason } of [...drain.rejected, ...drain.isolated]) {
      if (await quarantinePersonalEntry(user, entry, reason)) quarantined += 1;
      else changedDuringUpload = true;
    }
    if (!changedDuringUpload) break;
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

export type SyncMediaResult = { synced: number; quarantined: number };

export async function syncMediaOutbox(
  _orgId: string,
  _options?: { signal?: AbortSignal; maxAttempts?: number },
): Promise<SyncMediaResult> {
  return { synced: 0, quarantined: 0 };
}
