/**
 * Shared offline write-outbox. Scouting keeps its own store; everything else
 * (tasks, RSVP, hours, match notes, pit checks, chat) queues here with the
 * same idempotent clientId pattern.
 *
 * IndexedDB rule: open one transaction and enqueue every request synchronously.
 * Never await between opening the transaction and using it.
 */

export const OUTBOX_FEATURES = [
  "task_tick",
  "task_create",
  "calendar_rsvp",
  "hours_clock",
  "match_note",
  "pit_checklist",
  "chat_message",
  "packing_action",
  "batteries_action",
  "season_task",
  "pit_board",
  "calendar_action",
] as const;

export type OutboxFeature = (typeof OUTBOX_FEATURES)[number];

export type OutboxStatus = "queued" | "syncing" | "synced" | "conflict";

export type OutboxItem<T = unknown> = {
  clientId: string;
  feature: OutboxFeature;
  orgId: string;
  payload: T;
  queuedAt: string;
  status: OutboxStatus;
  lastError?: string;
  /** Server copy shown on last-write-wins conflict. */
  serverCopy?: unknown;
};

const DB_NAME = "vantage-outbox";
const DB_VERSION = 1;
const STORE = "writes";

export function isOutboxFeature(value: unknown): value is OutboxFeature {
  return typeof value === "string" && (OUTBOX_FEATURES as readonly string[]).includes(value);
}

export function newOutboxClientId(now = Date.now()): string {
  return `ob-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
        db.createObjectStore(STORE, { keyPath: "clientId" });
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

export async function enqueueOutboxItem<T>(
  item: Omit<OutboxItem<T>, "queuedAt" | "status"> & { queuedAt?: string; status?: OutboxStatus },
): Promise<OutboxItem<T>> {
  const row: OutboxItem<T> = {
    ...item,
    queuedAt: item.queuedAt ?? new Date().toISOString(),
    status: item.status ?? "queued",
  };
  if (typeof indexedDB === "undefined") return row;
  const db = await openDatabase();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await requestValue(store.put(row));
  return row;
}

export async function listOutbox(orgId?: string): Promise<OutboxItem[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDatabase();
  const store = db.transaction(STORE, "readonly").objectStore(STORE);
  const rows = (await requestValue(store.getAll())) as OutboxItem[];
  const org = orgId?.trim();
  return org ? rows.filter((row) => row.orgId === org) : rows;
}

export async function markOutboxItem(
  clientId: string,
  patch: Pick<OutboxItem, "status"> & { lastError?: string; serverCopy?: unknown },
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const current = (await requestValue(store.get(clientId))) as OutboxItem | undefined;
  if (!current) return;
  await requestValue(store.put({ ...current, ...patch }));
}

export async function dropOutboxItem(clientId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDatabase();
  const store = db.transaction(STORE, "readwrite").objectStore(STORE);
  await requestValue(store.delete(clientId));
}

export type OutboxSyncAdapter = {
  feature: OutboxFeature;
  endpoint: (item: OutboxItem) => { url: string; method: string; body: unknown };
};

export const DEFAULT_OUTBOX_ADAPTERS: OutboxSyncAdapter[] = [
  { feature: "task_tick", endpoint: (item) => ({ url: "/api/todos", method: "POST", body: item.payload }) },
  { feature: "task_create", endpoint: (item) => ({ url: "/api/todos", method: "POST", body: item.payload }) },
  { feature: "calendar_rsvp", endpoint: (item) => ({ url: "/api/team/calendar", method: "POST", body: item.payload }) },
  { feature: "hours_clock", endpoint: (item) => ({ url: "/api/hours", method: "POST", body: item.payload }) },
  { feature: "match_note", endpoint: (item) => ({ url: "/api/match-notes-timeline", method: "POST", body: item.payload }) },
  { feature: "pit_checklist", endpoint: (item) => ({ url: "/api/match-checklist", method: "POST", body: item.payload }) },
  { feature: "chat_message", endpoint: (item) => ({ url: "/api/messages", method: "POST", body: item.payload }) },
  { feature: "packing_action", endpoint: (item) => ({ url: "/api/packing", method: "POST", body: item.payload }) },
  { feature: "batteries_action", endpoint: (item) => ({ url: "/api/batteries", method: "POST", body: item.payload }) },
  { feature: "season_task", endpoint: (item) => ({ url: "/api/tasks", method: "POST", body: item.payload }) },
  { feature: "pit_board", endpoint: (item) => ({ url: "/api/pit", method: "POST", body: item.payload }) },
  { feature: "calendar_action", endpoint: (item) => ({ url: "/api/calendar", method: "POST", body: item.payload }) },
];

export function nextBackoffMs(attempt: number): number {
  const n = Math.max(0, Math.min(8, Math.floor(attempt)));
  return Math.min(60_000, 500 * 2 ** n);
}

export type OutboxSyncResult = {
  synced: number;
  conflicts: number;
  remaining: number;
};

/**
 * Push queued writes. Last-write-wins: HTTP 409 with a `server` field keeps
 * the server copy on the item and marks it conflict so the UI can show it.
 */
export async function syncOutbox(input: {
  orgId: string;
  fetchImpl?: typeof fetch;
  adapters?: OutboxSyncAdapter[];
  online?: boolean;
}): Promise<OutboxSyncResult> {
  const online = input.online ?? (typeof navigator === "undefined" ? true : navigator.onLine);
  if (!online) {
    const queued = await listOutbox(input.orgId);
    return { synced: 0, conflicts: 0, remaining: queued.filter((row) => row.status === "queued").length };
  }
  const adapters = input.adapters ?? DEFAULT_OUTBOX_ADAPTERS;
  const byFeature = new Map(adapters.map((adapter) => [adapter.feature, adapter]));
  const fetchImpl = input.fetchImpl ?? fetch;
  const queued = (await listOutbox(input.orgId)).filter((row) => row.status === "queued");
  let synced = 0;
  let conflicts = 0;
  for (const item of queued) {
    const adapter = byFeature.get(item.feature);
    if (!adapter) continue;
    await markOutboxItem(item.clientId, { status: "syncing" });
    const req = adapter.endpoint(item);
    try {
      const response = await fetchImpl(req.url, {
        method: req.method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...((req.body as object) ?? {}), clientId: item.clientId, orgId: item.orgId }),
      });
      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as { server?: unknown };
        await markOutboxItem(item.clientId, { status: "conflict", serverCopy: body.server });
        conflicts += 1;
        continue;
      }
      if (!response.ok) {
        await markOutboxItem(item.clientId, { status: "queued", lastError: `HTTP ${response.status}` });
        continue;
      }
      await dropOutboxItem(item.clientId);
      synced += 1;
    } catch (error) {
      await markOutboxItem(item.clientId, {
        status: "queued",
        lastError: error instanceof Error ? error.message : "sync failed",
      });
    }
  }
  const remaining = (await listOutbox(input.orgId)).filter((row) => row.status === "queued" || row.status === "conflict")
    .length;
  return { synced, conflicts, remaining };
}
