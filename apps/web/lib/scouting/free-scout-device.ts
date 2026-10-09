import type { FreeScoutReport } from "./free-scout";

export type PendingFreeReport = { key: string; orgId: string; userId: string; report: FreeScoutReport; error?: string };
export function freeScoutDeviceKey(orgId: string, userId: string) { return `free-scout:${orgId}:${userId}`; }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vantage-free-scout", 1);
    let settled = false;
    const fail = (error: Error | DOMException | null) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      reject(error ?? new Error("Device storage is unavailable."));
    };
    const timeout = setTimeout(() => fail(new Error("Device storage took too long to open. Keep this report open and retry.")), 10_000);
    request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "key" });
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true; clearTimeout(timeout); resolve(request.result);
    };
    request.onblocked = () => fail(new Error("Close the other Vantage tab to update device report storage, then retry."));
    request.onerror = () => fail(request.error);
  });
}

async function write(work: (store: IDBObjectStore) => void) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("reports", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Device storage could not save this report."));
      work(tx.objectStore("reports"));
    });
  } finally { db.close(); }
}

export async function queueFreeReport(orgId: string, userId: string, report: FreeScoutReport) {
  const row: PendingFreeReport = { key: `${freeScoutDeviceKey(orgId, userId)}:${report.id}`, orgId, userId, report };
  await write((store) => { store.put(row); });
}

export async function removePendingFreeReport(orgId: string, userId: string, id: string) {
  await write((store) => { store.delete(`${freeScoutDeviceKey(orgId, userId)}:${id}`); });
}

export async function pendingFreeReports(orgId: string, userId: string): Promise<PendingFreeReport[]> {
  const db = await database();
  try {
    const rows = await new Promise<PendingFreeReport[]>((resolve, reject) => {
      const req = db.transaction("reports").objectStore("reports").getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return rows.filter((row) => row.orgId === orgId && row.userId === userId);
  } finally { db.close(); }
}

/** An older upload must never acknowledge a newer local correction. */
async function updateUploadedRevision(row: PendingFreeReport, error?: string) {
  await write(store => {
    const read = store.get(row.key);
    read.onsuccess = () => {
      const current = read.result as PendingFreeReport | undefined;
      if (!current || JSON.stringify(current.report) !== JSON.stringify(row.report)) return;
      if (error) store.put({ ...current, error });
      else store.delete(row.key);
    };
  });
}

/** A failed or unauthenticated request never removes a local report. */
export async function syncFreeReports(orgId: string, userId: string, fetcher: typeof fetch = fetch, options: { retryRejected?: boolean } = {}) {
  const pending = (await pendingFreeReports(orgId, userId)).filter(row => !row.error || options.retryRejected);
  if (!pending.length) return;
  const identity = await fetcher(`/api/scouting/free-reports?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!identity.ok || (await identity.json()).userId !== userId) throw new Error("Sign in with the account that saved these reports to upload them.");
  for (const row of pending) {
    const response = await fetcher("/api/scouting/free-reports", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ orgId, userId, report: row.report }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.id === row.report.id) await updateUploadedRevision(row);
    else {
      // Transport failures remain retryable; invalid answers require a correction.
      if (response.status >= 500 || response.status === 429 || response.ok) throw new Error("Upload could not be confirmed. Your report stays on this device.");
      const message = typeof body.error === "string" ? body.error : "Upload rejected. Review this report before retrying.";
      await updateUploadedRevision(row, message);
      if (response.status === 401 || response.status === 403) throw new Error(message);
    }
  }
}
