import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FILE_BYTES_CAP,
  assemblyPdfOfflineKey,
  driveFileOfflineKey,
  dropOfflineFile,
  formatOfflineUsage,
  getOfflineFile,
  listOfflineFiles,
  putOfflineFile,
} from "./file-bytes";

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
      put(value: { key: string }) {
        table().set(value.key, { ...value });
        return requestOf(value.key);
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
}

describe("offline file bytes", () => {
  beforeEach(() => {
    installMemoryIndexedDb();
  });

  afterEach(() => {
    // keep the fake IDB for isolation per test via beforeEach
  });

  it("stores a file under the org and reports usage", async () => {
    const key = driveFileOfflineKey(ORG, "file-1");
    const result = await putOfflineFile({
      key,
      orgId: ORG,
      name: "battery-checklist.pdf",
      byteSize: 1200,
      contentType: "application/pdf",
      savedAt: "2026-09-10T00:00:00Z",
      sourceUrl: "/api/drive/files/file-1/content",
      blob: new Blob(["pdf"], { type: "application/pdf" }),
    });
    expect(result).toEqual({ ok: true });
    expect((await listOfflineFiles(ORG)).map((row) => row.name)).toEqual(["battery-checklist.pdf"]);
    const stored = await getOfflineFile(key);
    expect(stored?.name).toBe("battery-checklist.pdf");
    await dropOfflineFile(key);
    expect(await listOfflineFiles(ORG)).toEqual([]);
  });

  it("refuses a put that would pass the device cap", async () => {
    const result = await putOfflineFile({
      key: assemblyPdfOfflineKey(ORG, "run-1"),
      orgId: ORG,
      name: "huge.pdf",
      byteSize: FILE_BYTES_CAP + 1,
      contentType: "application/pdf",
      savedAt: "2026-09-10T00:00:00Z",
      sourceUrl: "/api/assembly-manual/run-1/pdf",
      blob: new Blob(["x"]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/200 MB/);
  });

  it("formats usage for the Files banner", () => {
    expect(formatOfflineUsage(512)).toBe("512 B");
    expect(formatOfflineUsage(2048)).toBe("2 KB");
    expect(formatOfflineUsage(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});
