import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/status must answer while the database is down: importing the database at all fails.
vi.mock("@vantage/db", () => {
  throw new Error("GET /api/status must not touch the database");
});

const { MemoryOutageStore, setOutageStoreForTests } = await import("./status-store");
const { forgetCachedPublicStatus, turnOffNotice, turnOnNotice } = await import("./notice");
const { GET } = await import("../../app/api/status/route");

describe("GET /api/status", () => {
  let store: InstanceType<typeof MemoryOutageStore>;
  beforeEach(() => {
    store = new MemoryOutageStore();
    setOutageStoreForTests(store);
    forgetCachedPublicStatus();
  });

  it("says not limited by default, cached for at most 30 s", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ limited: false });
    const cache = response.headers.get("cache-control") ?? "";
    expect(cache).toMatch(/public/);
    const maxAges = [...cache.matchAll(/(?:s-)?max-age=(\d+)/g)].map((match) => Number(match[1]));
    expect(maxAges.length).toBeGreaterThan(0);
    expect(Math.max(...maxAges)).toBeLessThanOrEqual(30);
  });

  it("returns { limited, message, since } once the console turns the banner on, and only that", async () => {
    await turnOnNotice(store, { message: "Vantage is running with limited features.", incidentId: "incident_1", now: Date.parse("2026-10-11T12:00:00Z") });
    const body = await (await GET()).json();
    expect(body).toEqual({ limited: true, message: "Vantage is running with limited features.", since: "2026-10-11T12:00:00.000Z" });
    expect(Object.keys(body).sort()).toEqual(["limited", "message", "since"]);

    await turnOffNotice(store);
    expect(await (await GET()).json()).toEqual({ limited: false });
  });

  it("answers not limited when the outage store itself fails", async () => {
    setOutageStoreForTests({
      kind: "upstash",
      get: async () => {
        throw new Error("down");
      },
      set: async () => false,
      delete: async () => undefined,
    });
    expect(await (await GET()).json()).toEqual({ limited: false });
  });

  it("in backup mode is always limited with the backup message, without reading the store", async () => {
    vi.stubEnv("VANTAGE_BACKUP_MODE", "1");
    try {
      setOutageStoreForTests({
        kind: "upstash",
        get: async () => {
          throw new Error("backup mode must not read the outage store");
        },
        set: async () => false,
        delete: async () => undefined,
      });
      const body = await (await GET()).json();
      expect(body).toMatchObject({ limited: true, since: "backup-mode" });
      expect(body.message).toMatch(/Google Sheets copy/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
