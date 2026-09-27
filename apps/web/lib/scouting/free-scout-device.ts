import type { FreeScoutReport } from "./free-scout";

export type PendingFreeReport = { key: string; orgId: string; userId: string; report: FreeScoutReport; error?: string };
export function freeScoutDeviceKey(orgId: string, userId: string) { return `free-scout:${orgId}:${userId}`; }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vantage-free-scout", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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

/** A failed or unauthenticated request never removes a local report. */
export async function syncFreeReports(orgId: string, userId: string, fetcher: typeof fetch = fetch) {
  const identity = await fetcher(`/api/scouting/free-reports?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
  if (!identity.ok || (await identity.json()).userId !== userId) throw new Error("Sign in with the account that saved these reports to upload them.");
  for (const row of await pendingFreeReports(orgId, userId)) {
    const response = await fetcher("/api/scouting/free-reports", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, userId, report: row.report }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.id === row.report.id) await write((store) => { store.delete(row.key); });
    else await write((store) => { store.put({ ...row, error: body.error ?? "Upload failed. Retry when connected." }); });
  }
}
