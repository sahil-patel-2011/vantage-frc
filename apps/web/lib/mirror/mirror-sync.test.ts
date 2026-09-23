import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { GoogleSheetsError } from "../google-sheets/google-api";
import { GraphError } from "../microsoft/graph";
import type { CellValue, TableSpec } from "../microsoft/workbook-schema";
import type { WorkbookTarget } from "../microsoft/workbook-sync";
import { contentHash } from "./mirror-hash";
import { type MirrorTargetDef, clampThrottle, isDeferred, syncMirror, writeTablesToCopy } from "./mirror-sync";

// TEST-ONLY in-memory copy: "a workbook of named tables", like workbook-sync.test.ts.
class MemoryCopy implements WorkbookTarget {
  readonly tables = new Map<string, { columns: string[]; rows: CellValue[][] }>();
  failOn = new Map<string, Error>();
  closed = 0;
  async ensureTable(spec: TableSpec) {
    const failure = this.failOn.get(spec.table);
    if (failure) throw failure;
    if (!this.tables.has(spec.table)) this.tables.set(spec.table, { columns: [...spec.columns], rows: [] });
  }
  async replaceRows(spec: TableSpec, rows: CellValue[][]) {
    this.tables.get(spec.table)!.rows = rows.map((row) => [...row]);
  }
  async close() {
    this.closed += 1;
  }
  snapshot() {
    return JSON.stringify([...this.tables.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  }
}

const ORG = "6925a000-0000-4000-8000-000000000001";
const USER = "6925a000-0000-4000-8000-000000000002";
const clock = () => new Date("2026-09-23T12:00:00Z");

function fakeClient(options: { locked?: boolean } = {}) {
  const log: Array<{ sql: string; params: unknown[] }> = [];
  let runs = 0;
  const client = {
    async query(sql: string, params: unknown[] = []) {
      log.push({ sql, params });
      const rows = (r: unknown[]) => ({ rows: r, rowCount: r.length });
      if (sql.includes("pg_try_advisory_xact_lock")) return rows([{ locked: options.locked ?? true }]);
      if (sql.includes("INSERT INTO workbook_sync_runs")) return rows([{ id: `run-${++runs}` }]);
      if (sql.includes("FROM organizations o")) return rows([{ name: "Robo Team", teamNumber: 1234, activeEventKey: "2026casj" }]);
      if (sql.includes("WITH roster AS")) {
        return rows([{ teamKey: "frc254", teamNumber: 254, nickname: "Cheesy Poofs", epaTotal: "61.2", metricsSource: "statbotics", updatedAt: "2026-09-20T00:00:00Z" }]);
      }
      if (sql.includes("FROM matches_ref")) return rows([]);
      if (sql.includes("FROM match_scout_entries")) return rows([]);
      if (sql.includes("FROM pit_scout_entries")) return rows([]);
      if (sql.includes("FROM pick_lists p")) return rows([]);
      if (sql.includes("FROM pick_list_entries e")) return rows([]);
      if (sql.includes("FROM pick_list_entry_votes")) return rows([]);
      if (sql.startsWith("UPDATE") || sql.includes("UPDATE workbook_sync_runs")) return rows([]);
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
  return { client: client as unknown as PoolClient, log };
}

function def(copy: "excel" | "google", target: WorkbookTarget | (() => Promise<WorkbookTarget>), extra: Partial<MirrorTargetDef> = {}): MirrorTargetDef {
  return {
    copy,
    open: typeof target === "function" ? target : async () => target,
    describe: (error) => (error instanceof Error ? error.message : "failed"),
    isFatal: () => false,
    throttle: (error) =>
      error instanceof GoogleSheetsError && error.kind === "throttled"
        ? (error.retryAfterMs ?? 0)
        : error instanceof GraphError && error.kind === "throttled"
          ? (error.retryAfterMs ?? 0)
          : null,
    throttledUntil: null,
    ...extra,
  };
}

describe("syncMirror", () => {
  it("writes byte-identical tables to both copies and stamps both with one hash", async () => {
    const excel = new MemoryCopy();
    const google = new MemoryCopy();
    const { client, log } = fakeClient();
    const result = await syncMirror(client, ORG, { targets: [def("excel", excel), def("google", google)], userId: USER, now: clock });

    expect(result.status).toBe("done");
    if (result.status !== "done") return;
    expect(result.copies.map((copy) => copy.status)).toEqual(["succeeded", "succeeded"]);
    expect(excel.snapshot()).toBe(google.snapshot());

    // One Postgres read for both copies, not one each.
    expect(log.filter((entry) => entry.sql.includes("WITH roster AS"))).toHaveLength(1);

    const stamps = log.filter((entry) => entry.sql.includes("last_sync_hash = $3::text"));
    expect(stamps.map((entry) => entry.params[2])).toEqual([result.hash, result.hash]);
    expect(stamps[0]!.sql).toContain("org_microsoft_connections");
    expect(stamps[1]!.sql).toContain("org_google_sheets_connections");

    const runs = log.filter((entry) => entry.sql.includes("INSERT INTO workbook_sync_runs"));
    expect(runs.map((entry) => entry.params[3])).toEqual(["excel", "google"]);

    // Each copy's SyncInfo shows the hash a person can compare by eye.
    const syncInfo = google.tables.get("VantageSyncInfo")!.rows;
    expect(syncInfo.some((row) => row[0] === "content_hash" && row[1] === result.hash)).toBe(true);
  });

  it("keeps writing Google when Excel cannot even be opened, and does not stamp Excel", async () => {
    const google = new MemoryCopy();
    const { client, log } = fakeClient();
    const result = await syncMirror(client, ORG, {
      targets: [
        def("excel", async () => {
          throw new GraphError("unavailable", "Microsoft 365 did not answer.");
        }),
        def("google", google),
      ],
      now: clock,
    });
    if (result.status !== "done") throw new Error("expected done");
    expect(result.copies[0]).toMatchObject({ copy: "excel", status: "failed" });
    expect(result.copies[1]).toMatchObject({ copy: "google", status: "succeeded" });
    expect(google.tables.size).toBeGreaterThan(0);
    const stamped = log.filter((entry) => entry.sql.includes("last_sync_hash = $3::text"));
    expect(stamped).toHaveLength(1);
    expect(stamped[0]!.sql).toContain("org_google_sheets_connections");
  });

  it("rests a throttled copy and lets the other carry the sync", async () => {
    const excel = new MemoryCopy();
    const google = new MemoryCopy();
    google.failOn.set("VantageTeams", new GoogleSheetsError("throttled", "quota", 429, "RESOURCE_EXHAUSTED", 120_000));
    const { client, log } = fakeClient();
    const result = await syncMirror(client, ORG, { targets: [def("excel", excel), def("google", google)], now: clock });
    if (result.status !== "done") throw new Error("expected done");
    expect(result.copies[0]!.status).toBe("succeeded");
    expect(result.copies[1]!.status).toBe("failed");
    const rest = log.find((entry) => entry.sql.includes("throttled_until = COALESCE"));
    expect(rest?.params[4]).toBe(new Date(clock().getTime() + 120_000).toISOString());
  });

  it("skips a copy that is still resting, without opening it", async () => {
    const excel = new MemoryCopy();
    let opened = false;
    const { client } = fakeClient();
    const result = await syncMirror(client, ORG, {
      targets: [
        def("excel", excel),
        def(
          "google",
          async () => {
            opened = true;
            return new MemoryCopy();
          },
          { throttledUntil: "2026-09-23T12:30:00Z" },
        ),
      ],
      now: clock,
    });
    if (result.status !== "done") throw new Error("expected done");
    expect(result.copies[1]).toMatchObject({ copy: "google", status: "deferred", runId: null });
    expect(opened).toBe(false);
  });

  it("returns busy instead of interleaving with another sync or import", async () => {
    const { client } = fakeClient({ locked: false });
    await expect(syncMirror(client, ORG, { targets: [def("excel", new MemoryCopy())] })).resolves.toEqual({ status: "busy" });
  });

  it("gives the same hash to the same data, whatever time it is", async () => {
    const a = await syncMirror(fakeClient().client, ORG, { targets: [def("excel", new MemoryCopy())], now: clock });
    const b = await syncMirror(fakeClient().client, ORG, {
      targets: [def("excel", new MemoryCopy())],
      now: () => new Date("2026-09-24T08:00:00Z"),
    });
    if (a.status !== "done" || b.status !== "done") throw new Error("expected done");
    expect(a.hash).toBe(b.hash);
  });
});

describe("writeTablesToCopy", () => {
  it("stops after a sign-in failure instead of failing every table the slow way", async () => {
    const copy = new MemoryCopy();
    copy.failOn.set("VantageTeams", new GraphError("auth_expired", "expired", 401));
    const tables = [
      { spec: { entity: "Teams" as const, sheet: "Teams", table: "VantageTeams", columns: ["id"] }, rows: [["a"]] },
      { spec: { entity: "Matches" as const, sheet: "Matches", table: "VantageMatches", columns: ["id"] }, rows: [["b"]] },
    ];
    const { outcomes } = await writeTablesToCopy(copy, tables, {
      describe: () => "signed out",
      isFatal: (error) => error instanceof GraphError && error.kind === "auth_expired",
      throttle: () => null,
    });
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([false, false]);
    expect(copy.tables.has("VantageMatches")).toBe(false);
  });
});

describe("throttle bookkeeping", () => {
  it("rests at least a minute and at most an hour", () => {
    expect(clampThrottle(null)).toBe(10 * 60_000);
    expect(clampThrottle(0)).toBe(10 * 60_000);
    expect(clampThrottle(5_000)).toBe(60_000);
    expect(clampThrottle(5 * 60 * 60_000)).toBe(60 * 60_000);
  });

  it("knows whether a copy is still resting", () => {
    expect(isDeferred(null, clock())).toBe(false);
    expect(isDeferred("2026-09-23T11:00:00Z", clock())).toBe(false);
    expect(isDeferred("2026-09-23T13:00:00Z", clock())).toBe(true);
  });

  it("hashes only data tables", () => {
    const spec = (entity: "Teams" | "SyncInfo") => ({ entity, sheet: entity, table: `Vantage${entity}`, columns: ["id"] });
    const base = [{ spec: spec("Teams"), rows: [["frc254"]] }];
    expect(contentHash([...base, { spec: spec("SyncInfo"), rows: [["synced_at"]] }])).toBe(contentHash(base));
    expect(contentHash([{ spec: spec("Teams"), rows: [["frc1678"]] }])).not.toBe(contentHash(base));
  });
});
