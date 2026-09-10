import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_OUTBOX_ADAPTERS,
  enqueueOutboxItem,
  listOutbox,
  nextBackoffMs,
  newOutboxClientId,
  syncOutbox,
} from "./outbox";

const ORG = "11111111-1111-4111-8111-111111111111";

function installMemoryIndexedDb() {
  const tables = new Map<string, Map<string, unknown>>();

  function requestOf<T>(value: T, error: DOMException | null = null): IDBRequest<T> {
    const request = {
      result: value,
      error,
      onsuccess: null as ((this: IDBRequest<T>, ev: Event) => void) | null,
      onerror: null as ((this: IDBRequest<T>, ev: Event) => void) | null,
    };
    queueMicrotask(() => {
      if (error) request.onerror?.call(request as IDBRequest<T>, new Event("error"));
      else request.onsuccess?.call(request as IDBRequest<T>, new Event("success"));
    });
    return request as IDBRequest<T>;
  }

  function objectStore(name: string) {
    const table = () => {
      const existing = tables.get(name);
      if (!existing) throw new Error(`store ${name} missing`);
      return existing;
    };
    return {
      put(value: { clientId: string }) {
        table().set(value.clientId, { ...value });
        return requestOf(value.clientId);
      },
      get(key: string) {
        return requestOf(table().get(key));
      },
      getAll() {
        return requestOf([...table().values()]);
      },
      delete(key: string) {
        table().delete(key);
        return requestOf(undefined);
      },
    };
  }

  const db = {
    objectStoreNames: { contains: (name: string) => tables.has(name) },
    createObjectStore(name: string) {
      if (!tables.has(name)) tables.set(name, new Map());
      return objectStore(name);
    },
    transaction(name: string) {
      return { objectStore: () => objectStore(name) };
    },
  };

  const indexedDB = {
    open() {
      const request = {
        result: db,
        error: null,
        onupgradeneeded: null as ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => void) | null,
        onsuccess: null as ((this: IDBOpenDBRequest, ev: Event) => void) | null,
        onerror: null as ((this: IDBOpenDBRequest, ev: Event) => void) | null,
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.call(request as IDBOpenDBRequest, new Event("upgradeneeded") as IDBVersionChangeEvent);
        request.onsuccess?.call(request as IDBOpenDBRequest, new Event("success"));
      });
      return request as unknown as IDBOpenDBRequest;
    },
  };

  Object.defineProperty(globalThis, "indexedDB", { value: indexedDB, configurable: true, writable: true });
  return tables;
}

describe("offline outbox", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    installMemoryIndexedDb();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("queues a write and syncs it once the network answers 200", async () => {
    const clientId = newOutboxClientId(1);
    await enqueueOutboxItem({
      clientId,
      feature: "task_tick",
      orgId: ORG,
      payload: { id: "todo-1", done: true },
    });
    expect((await listOutbox(ORG)).map((row) => row.feature)).toEqual(["task_tick"]);

    globalThis.fetch = (async () => ({ ok: true, status: 200, json: async () => ({}) })) as typeof fetch;
    const result = await syncOutbox({ orgId: ORG, fetchImpl: globalThis.fetch, online: true });
    expect(result).toEqual({ synced: 1, conflicts: 0, remaining: 0 });
    expect(await listOutbox(ORG)).toEqual([]);
  });

  it("routes packing, batteries, pit, and season-task writes to their product APIs", () => {
    const webRoot = join(__dirname, "..", "..");
    const item = {
      clientId: "c",
      feature: "packing_action" as const,
      orgId: ORG,
      payload: { action: "toggle_item" },
      queuedAt: new Date().toISOString(),
      status: "queued" as const,
    };
    const extra = DEFAULT_OUTBOX_ADAPTERS.filter((adapter) =>
      ["packing_action", "batteries_action", "season_task", "pit_board"].includes(adapter.feature),
    );
    expect(extra).toHaveLength(4);
    for (const adapter of extra) {
      const req = adapter.endpoint(item);
      const rel = req.url.replace(/^\//, "");
      expect(
        existsSync(join(webRoot, "app", rel, "route.ts")),
        `${adapter.feature} → ${req.url}`,
      ).toBe(true);
    }
  });

  it("keeps the server copy on a 409 instead of dropping the local write", async () => {
    await enqueueOutboxItem({
      clientId: "c1",
      feature: "chat_message",
      orgId: ORG,
      payload: { body: "queued" },
    });
    globalThis.fetch = (async () => ({
      ok: false,
      status: 409,
      json: async () => ({ server: { body: "already sent" } }),
    })) as typeof fetch;
    const result = await syncOutbox({ orgId: ORG, fetchImpl: globalThis.fetch, online: true });
    expect(result.conflicts).toBe(1);
    expect((await listOutbox(ORG))[0]?.status).toBe("conflict");
    expect((await listOutbox(ORG))[0]?.serverCopy).toEqual({ body: "already sent" });
  });

  it("backs off exponentially and does not sync while offline", async () => {
    expect(nextBackoffMs(0)).toBe(500);
    expect(nextBackoffMs(3)).toBe(4000);
    expect(nextBackoffMs(20)).toBe(60_000);
    await enqueueOutboxItem({
      clientId: "c2",
      feature: "task_create",
      orgId: ORG,
      payload: { title: "Scout quals" },
    });
    const result = await syncOutbox({ orgId: ORG, online: false });
    expect(result).toEqual({ synced: 0, conflicts: 0, remaining: 1 });
  });

  it("posts queued writes to product API routes that exist in this repo", () => {
    const webRoot = join(__dirname, "..", "..");
    const item = {
      clientId: "c",
      feature: "task_tick" as const,
      orgId: ORG,
      payload: {},
      queuedAt: new Date().toISOString(),
      status: "queued" as const,
    };
    for (const adapter of DEFAULT_OUTBOX_ADAPTERS) {
      const req = adapter.endpoint(item);
      expect(req.method).toBe("POST");
      const rel = req.url.replace(/^\//, "");
      const candidates = [
        join(webRoot, "app", rel, "route.ts"),
        join(webRoot, "app", `${rel}.ts`),
      ];
      expect(
        candidates.some((path) => existsSync(path)),
        `${adapter.feature} → ${req.url} is not a route`,
      ).toBe(true);
    }
  });
});
