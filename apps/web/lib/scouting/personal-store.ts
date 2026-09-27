import { offlineSnapshotUser } from "../offline/identity";

/** Legacy vantage-scouting records have no reliable account owner. Preserve that database
 * without exposing or adopting its contents when another person signs in. */
export const LEGACY_SCOUT_DATABASE = "vantage-scouting";
export const PERSONAL_SCOUT_PREFIX = "vantage-scouting-person-";

export async function scoutStorageUser(orgId = ""): Promise<string | null> {
  return offlineSnapshotUser(orgId);
}

export async function requireScoutStorageUser(orgId = ""): Promise<string> {
  const user = await scoutStorageUser(orgId);
  if (!user) throw new Error("Sign in before saving scouting on this device.");
  return user;
}

export async function assertScoutStorageUser(user: string, orgId = ""): Promise<void> {
  if (await scoutStorageUser(orgId) !== user) throw new Error("Your account changed. Sign in again before syncing.");
}

export function idbValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openPersonalDatabase(user: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PERSONAL_SCOUT_PREFIX + encodeURIComponent(user), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("entry-outbox", { keyPath: "clientId" });
      db.createObjectStore("entry-quarantine", { keyPath: "clientId" });
      db.createObjectStore("event-cache", { keyPath: "orgId" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Vantage tabs to update offline storage."));
  });
}

/** Wait for the transaction's commit, not just an individual put's success. */
export async function scoutTransaction<T>(
  user: string,
  names: string | string[],
  mode: IDBTransactionMode,
  work: (transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await openPersonalDatabase(user);
  try {
    const transaction = db.transaction(names, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline save was interrupted."));
    });
    // Register rejection handling before work can fail or abort the transaction.
    void done.catch(() => undefined);
    try {
      const result = await work(transaction);
      await done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* The transaction may already have ended. */ }
      await done.catch(() => undefined);
      throw error;
    }
  } finally {
    db.close();
  }
}
