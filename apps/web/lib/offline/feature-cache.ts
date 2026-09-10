/**
 * Shared IndexedDB snapshots for offline-capable product pages.
 * Scouting keeps its dedicated outbox in scout-offline.ts; other features
 * read last-good API payloads here when venue Wi-Fi drops.
 */

export type OfflineFeature =
  | "calendar"
  | "team-calendar"
  | "todos"
  | "logistics"
  | "my-day"
  | "competition"
  | "files"
  | "docs"
  | "dashboard"
  | "chat"
  | "video-analysis"
  | "relays"
  | "strategy"
  | "hours"
  | "match-checklist"
  | "match-notes"
  | "packing"
  | "batteries"
  | "pit"
  | "season-tasks"
  | "schedule"
  | "assembly-manual"
  | "chemistry"
  | "pick-clock"
  | "alliance-desk"
  | "print-farm"
  | "inventory"
  | "defense-planner"
  | "picklist-collab"
  | "dossier"
  | "pit-repair"
  | "event-day-plan";

const DB_NAME = "vantage-feature-cache";
const DB_VERSION = 1;
const STORE = "snapshots";

export type FeatureSnapshot<T> = {
  key: string;
  feature: OfflineFeature;
  orgId: string;
  data: T;
  cachedAt: string;
};

export function featureCacheKey(feature: OfflineFeature, orgId: string, variant = ""): string {
  const org = orgId.trim() || "_";
  const extra = variant.trim();
  return extra ? `${feature}:${org}:${extra}` : `${feature}:${org}`;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
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

export async function putFeatureSnapshot<T>(
  feature: OfflineFeature,
  orgId: string,
  data: T,
  variant = "",
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  const row: FeatureSnapshot<T> = {
    key: featureCacheKey(feature, orgId, variant),
    feature,
    orgId: orgId.trim() || "_",
    data,
    cachedAt: new Date().toISOString(),
  };
  await requestValue(store.put(row));
}

export async function getFeatureSnapshot<T>(
  feature: OfflineFeature,
  orgId: string,
  variant = "",
): Promise<FeatureSnapshot<T> | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDatabase();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  const row = await requestValue<FeatureSnapshot<T> | undefined>(
    store.get(featureCacheKey(feature, orgId, variant)),
  );
  return row ?? null;
}

export async function clearFeatureSnapshot(feature: OfflineFeature, orgId: string, variant = ""): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await requestValue(store.delete(featureCacheKey(feature, orgId, variant)));
}
