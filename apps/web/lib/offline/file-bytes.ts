/**
 * Bytes a student marked "keep on this device" (Drive files + assembly PDFs).
 * IndexedDB rule: open one transaction and enqueue every request synchronously.
 */

import { checkCacheSpace, GB, readOfflineBudget } from "./storage-budget";

export const FILE_BYTES_CAP = 2 * GB;
export const FILE_BYTES_CAP_LABEL = "your device cache budget";

export type OfflineFileMeta = {
  key: string;
  orgId: string;
  name: string;
  byteSize: number;
  contentType: string;
  savedAt: string;
  sourceUrl: string;
};

export type OfflineFileRecord = OfflineFileMeta & { blob: Blob };

const DB_NAME = "vantage-file-bytes";
const DB_VERSION = 1;
const STORE = "files";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export function driveFileOfflineKey(orgId: string, fileId: string): string {
  return `drive:${orgId.trim()}:${fileId}`;
}

export function assemblyPdfOfflineKey(orgId: string, runId: string): string {
  return `assembly-pdf:${orgId.trim()}:${runId}`;
}

export async function listOfflineFiles(orgId?: string): Promise<OfflineFileMeta[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDatabase();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  const rows = (await requestValue(store.getAll())) as OfflineFileRecord[];
  const org = orgId?.trim();
  return (org ? rows.filter((row) => row.orgId === org) : rows).map((row) => ({
    key: row.key,
    orgId: row.orgId,
    name: row.name,
    byteSize: row.byteSize,
    contentType: row.contentType,
    savedAt: row.savedAt,
    sourceUrl: row.sourceUrl,
  }));
}

export async function offlineFileUsageBytes(orgId?: string): Promise<number> {
  const rows = await listOfflineFiles(orgId);
  return rows.reduce((sum, row) => sum + (Number.isFinite(row.byteSize) ? row.byteSize : 0), 0);
}

export async function getOfflineFile(key: string): Promise<OfflineFileRecord | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDatabase();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  const row = (await requestValue(store.get(key))) as OfflineFileRecord | undefined;
  return row ?? null;
}

export async function dropOfflineFile(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await requestValue(store.delete(key));
}

export async function putOfflineFile(record: OfflineFileRecord): Promise<{ ok: true } | { ok: false; reason: string }> {
  const usage = await offlineFileUsageBytes();
  const existing = await getOfflineFile(record.key);
  const nextUsage = usage - (existing?.byteSize ?? 0) + record.byteSize;
  if (nextUsage > readOfflineBudget() * GB) {
    return {
      ok: false,
      reason: `This device is at its ${readOfflineBudget()} GB offline cache budget. Remove a kept file or change the budget in Account settings.`,
    };
  }
  if (typeof indexedDB === "undefined") {
    return { ok: false, reason: "This browser cannot keep files on the device." };
  }
  try { await checkCacheSpace(Math.max(0, record.byteSize - (existing?.byteSize ?? 0))); }
  catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "Device storage unavailable." }; }
  const db = await openDatabase();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await requestValue(store.put(record));
  return { ok: true };
}

export async function keepOfflineFile(input: {
  key: string;
  orgId: string;
  name: string;
  url: string;
  contentType?: string;
  expectedBytes?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const existing = await getOfflineFile(input.key);
  if (existing) return { ok: true };
  const expected = input.expectedBytes ?? 0;
  if (expected > 0) {
    const usage = await offlineFileUsageBytes();
    if (usage + expected > readOfflineBudget() * GB) {
      return {
        ok: false,
        reason: `This file exceeds the ${readOfflineBudget()} GB offline cache budget. Change it in Account settings.`,
      };
    }
    try { await checkCacheSpace(expected); }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : "Device storage unavailable." }; }
  }
  let response: Response;
  try {
    response = await fetch(input.url, { cache: "no-store" });
  } catch {
    return { ok: false, reason: "Could not download the file to keep it on this device." };
  }
  if (!response.ok) {
    return { ok: false, reason: "Could not download the file to keep it on this device." };
  }
  const blob = await response.blob();
  return putOfflineFile({
    key: input.key,
    orgId: input.orgId,
    name: input.name,
    byteSize: blobSize(blob, input.expectedBytes),
    contentType: input.contentType ?? (blob.type || "application/octet-stream"),
    savedAt: new Date().toISOString(),
    sourceUrl: input.url,
    blob,
  });
}

function blobSize(blob: Blob, expected?: number): number {
  if (Number.isFinite(blob.size) && blob.size > 0) return blob.size;
  if (expected && expected > 0) return expected;
  return 0;
}

export function formatOfflineUsage(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
