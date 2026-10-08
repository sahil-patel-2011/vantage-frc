import type { FreeScoutReport } from "./free-scout";

export type PendingFreeReport = { key: string; orgId: string; userId: string; report: FreeScoutReport; revision?: string; error?: string; retryable?: boolean };
export function freeScoutDeviceKey(orgId: string, userId: string) { return `free-scout:${orgId}:${userId}`; }

async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vantage-free-scout", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("reports", { keyPath: "key" });
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Vantage tabs to update device storage."));
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
  const row: PendingFreeReport = { key: `${freeScoutDeviceKey(orgId, userId)}:${report.id}`, orgId, userId, report, revision: crypto.randomUUID() };
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

/** Update only the revision sent: a newer local edit must survive an older acknowledgement. */
async function settleReport(row: PendingFreeReport, issue?: { error: string; retryable: boolean }) {
  await write((store) => {
    const request = store.get(row.key);
    request.onsuccess = () => {
      const current = request.result as PendingFreeReport | undefined;
      if (!current || current.revision !== row.revision || JSON.stringify(current.report) !== JSON.stringify(row.report)) return;
      if (issue) store.put({ ...current, ...issue });
      else store.delete(row.key);
    };
  });
}

const drains = new Map<string, Promise<void>>();

/**
 * Empty queues make no HTTP requests. Each POST verifies the session user and
 * team on the server, so there is no redundant full-history identity GET.
 * Rejected rows stay local and require an explicit retry or correction.
 */
export function syncFreeReports(
  orgId: string,
  userId: string,
  fetcher: typeof fetch = fetch,
  options: { retryRejected?: boolean } = {},
): Promise<void> {
  const key = freeScoutDeviceKey(orgId, userId);
  const active = drains.get(key);
  if (active) return active;
  const run = async () => {
    const rows = (await pendingFreeReports(orgId, userId)).filter(row => options.retryRejected || row.retryable !== false);
    for (const row of rows) {
      let response: Response;
      try {
        response = await fetcher("/api/scouting/free-reports", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orgId, userId, report: row.report }),
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        const error = "Upload interrupted. Your report is still on this device.";
        await settleReport(row, { error, retryable: true });
        throw new Error(error);
      }
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.id === row.report.id) await settleReport(row);
      else {
        const error = typeof body.error === "string" ? body.error : "Upload could not be confirmed. Your local report was kept.";
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        await settleReport(row, { error, retryable });
        // Stop an expired/changed session from requesting the rest on later ticks too.
        if (response.status === 401 || response.status === 403) {
          for (const pending of rows) if (pending.key !== row.key) await settleReport(pending, { error, retryable: false });
          throw new Error(error);
        }
        if (retryable) throw new Error(error);
      }
    }
  };
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
  const drain = (locks ? locks.request(`vantage-${key}`, run) : run()).finally(() => drains.delete(key));
  drains.set(key, drain);
  return drain;
}
