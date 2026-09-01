import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

/**
 * Minimal IndexedDB stand-in for Node. Only the methods the hours outbox uses
 * (open / createObjectStore / put / getAll / delete) are implemented.
 */
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

  const objectStoreNames = {
    contains: (name: string) => tables.has(name),
  };

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
    objectStoreNames,
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

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("kiosk-offline IndexedDB outbox", () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    installMemoryIndexedDb();
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: true },
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
    });
    vi.resetModules();
  });

  async function load() {
    return import("./kiosk-offline");
  }

  it("stores the captured scan time and drains it unchanged, oldest first", async () => {
    const { queueClockEvent, listQueuedClockEvents, syncClockOutbox } = await load();
    const first = await queueClockEvent({
      orgId: ORG,
      code: "A12345",
      kind: "build",
      occurredAt: "2026-02-14T18:02:00.000Z",
      clientId: "scan-first-xxxxxxxx",
    });
    await queueClockEvent({
      orgId: ORG,
      code: "B99887",
      kind: "build",
      occurredAt: "2026-02-14T20:31:00.000Z",
      clientId: "scan-second-xxxxxxx",
    });
    const queued = await listQueuedClockEvents(ORG);
    expect(queued.map((row) => row.clientId)).toEqual(["scan-first-xxxxxxxx", "scan-second-xxxxxxx"]);
    expect(queued[0]!.occurredAt).toBe(first.occurredAt);

    const bodies: Array<Record<string, unknown>> = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return jsonResponse(200, {
        outcome: "in",
        memberName: "Maya",
        userId: "u1",
        at: "2026-02-14T18:02:00.000Z",
        elapsedHours: null,
        backdated: true,
      });
    }) as typeof fetch;

    const result = await syncClockOutbox(ORG, { maxAttempts: 1 });
    expect(result.synced).toBe(2);
    expect(result.remaining).toBe(0);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({
      action: "scan",
      orgId: ORG,
      code: "A12345",
      kind: "build",
      occurredAt: "2026-02-14T18:02:00.000Z",
      clientEventId: "scan-first-xxxxxxxx",
    });
    expect(bodies[1]!.occurredAt).toBe("2026-02-14T20:31:00.000Z");
    expect(bodies[1]!.clientEventId).toBe("scan-second-xxxxxxx");
    for (const body of bodies) {
      expect(body).not.toHaveProperty("elapsedHours");
      expect(body).not.toHaveProperty("totalHours");
      expect(JSON.stringify(body)).not.toMatch(/DEMO/i);
    }
  });

  it("does not drain another org's scans", async () => {
    const { queueClockEvent, listQueuedClockEvents } = await load();
    await queueClockEvent({ orgId: ORG, code: "MINE01", kind: "build", clientId: "mine-scan-xxxxxxxx" });
    await queueClockEvent({ orgId: OTHER, code: "THEIRS", kind: "build", clientId: "their-scan-xxxxxxx" });
    const mine = await listQueuedClockEvents(ORG);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.code).toBe("MINE01");
  });

  it("keeps a permanently rejected scan and does not invent a replacement", async () => {
    const { queueClockEvent, listQueuedClockEvents, syncClockOutbox } = await load();
    await queueClockEvent({
      orgId: ORG,
      code: "UNKNOWN",
      kind: "build",
      occurredAt: "2026-02-14T18:02:00.000Z",
      clientId: "unknown-card-xxxxxx",
    });
    globalThis.fetch = (async () =>
      jsonResponse(404, { error: "Card not recognized — enroll it under Kiosk cards first." })) as typeof fetch;

    const result = await syncClockOutbox(ORG, { maxAttempts: 1 });
    expect(result.synced).toBe(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reason).toMatch(/not recognized/i);
    const still = await listQueuedClockEvents(ORG);
    expect(still).toHaveLength(1);
    expect(still[0]!.occurredAt).toBe("2026-02-14T18:02:00.000Z");
    expect(still[0]!.lastError).toMatch(/not recognized/i);
  });

  it("leaves a transient failure queued with its original time", async () => {
    const { queueClockEvent, listQueuedClockEvents, syncClockOutbox } = await load();
    await queueClockEvent({
      orgId: ORG,
      code: "A12345",
      kind: "build",
      occurredAt: "2026-02-14T18:02:00.000Z",
      clientId: "flaky-wifi-xxxxxxxx",
    });
    globalThis.fetch = (async () => jsonResponse(503, { error: "Venue Wi-Fi dropped" })) as typeof fetch;

    const result = await syncClockOutbox(ORG, { maxAttempts: 1 });
    expect(result.synced).toBe(0);
    expect(result.rejected).toHaveLength(0);
    const still = await listQueuedClockEvents(ORG);
    expect(still).toHaveLength(1);
    expect(still[0]!.occurredAt).toBe("2026-02-14T18:02:00.000Z");
    expect(still[0]!.lastError).toBeUndefined();
  });

  it("does not drain while the tablet is offline", async () => {
    const { queueClockEvent, syncClockOutbox } = await load();
    await queueClockEvent({ orgId: ORG, code: "A12345", kind: "build", clientId: "still-offline-xxxxxx" });
    Object.defineProperty(globalThis, "navigator", {
      value: { onLine: false },
      configurable: true,
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await syncClockOutbox(ORG, { maxAttempts: 1 });
    expect(result.synced).toBe(0);
    expect(result.remaining).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
