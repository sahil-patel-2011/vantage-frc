import { beforeEach, describe, expect, it, vi } from "vitest";

/** GET /api/health answers the monitor, then tells the outage tracker what it found. */
const state = vi.hoisted(() => ({
  db: "ok" as "ok" | "refused",
  failures: [] as Array<{ error: unknown; source: string }>,
  healthy: [] as string[],
}));

vi.mock("@vantage/db", () => ({
  withRls: async (_scope: unknown, work: (client: { query: () => Promise<unknown> }) => Promise<unknown>) => {
    if (state.db === "refused") {
      throw Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:5432"), { code: "ECONNREFUSED" });
    }
    return work({ query: async () => ({ rows: [{ "?column?": 1 }] }) });
  },
}));
vi.mock("./defer", () => ({ deferOutageWork: (task: () => Promise<unknown>) => void task() }));
vi.mock("./incident", () => ({
  reportDatabaseFailure: async (error: unknown, source: string) => {
    state.failures.push({ error, source });
  },
  reportDatabaseHealthy: async (source: string) => {
    state.healthy.push(source);
  },
}));

const { GET } = await import("../../app/api/health/route");

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("GET /api/health", () => {
  beforeEach(() => {
    state.db = "ok";
    state.failures = [];
    state.healthy = [];
  });

  it("200 when the database answers, and reports it healthy", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, database: "ok" });
    expect(Object.keys(body).sort()).toEqual(["checkedInMs", "database", "ok"]);
    await flush();
    expect(state.healthy).toEqual(["api/health"]);
    expect(state.failures).toEqual([]);
  });

  it("503 when it doesn't, without saying why, and reports the real error", async () => {
    state.db = "refused";
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, database: "unreachable" });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|203\.0/);
    await flush();
    expect(state.failures).toHaveLength(1);
    expect(state.failures[0]).toMatchObject({ source: "api/health", error: { code: "ECONNREFUSED" } });
    expect(state.healthy).toEqual([]);
  });

  it("in backup mode answers 503 backup_mode at once, probing and reporting nothing", async () => {
    vi.stubEnv("VANTAGE_BACKUP_MODE", "1");
    try {
      state.db = "refused";
      const response = await GET();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ ok: false, database: "backup_mode" });
      await flush();
      expect(state.failures).toEqual([]);
      expect(state.healthy).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
