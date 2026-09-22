import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { GraphError } from "./graph";
import type { CellValue, TableSpec } from "./workbook-schema";
import {
  type WorkbookTarget,
  normalizeTimestamp,
  summarizeOutcomes,
  syncOrgWorkbook,
  writeWorkbookTables,
} from "./workbook-sync";
import { buildWorkbookTables } from "./workbook-schema";

// ---------------------------------------------------------------------------
// TEST-ONLY in-memory WorkbookTarget. Never used by product code: the real target is
// GraphWorkbookTarget (workbook-target.ts). This one models "a workbook of named tables"
// so the sync's replace semantics can be checked without Microsoft.
// ---------------------------------------------------------------------------
class InMemoryWorkbookTarget implements WorkbookTarget {
  readonly tables = new Map<string, { sheet: string; columns: string[]; rows: CellValue[][] }>();
  closed = 0;
  failOn = new Map<string, Error>();

  async ensureTable(spec: TableSpec) {
    const failure = this.failOn.get(spec.table);
    if (failure) throw failure;
    const existing = this.tables.get(spec.table);
    if (!existing || existing.columns.join("\u0000") !== spec.columns.join("\u0000")) {
      this.tables.set(spec.table, { sheet: spec.sheet, columns: [...spec.columns], rows: [] });
    }
  }

  async replaceRows(spec: TableSpec, rows: CellValue[][]) {
    const table = this.tables.get(spec.table);
    if (!table) throw new Error(`no table ${spec.table}`);
    table.rows = rows.map((row) => [...row]);
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

type Recorded = { sql: string; params: unknown[] };

/** A fake withRls client that answers the sync's queries from fixtures, by SQL shape. */
function fakeClient(options: { locked?: boolean } = {}) {
  const log: Recorded[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      log.push({ sql, params });
      const rows = (r: unknown[]) => ({ rows: r, rowCount: r.length });
      if (sql.includes("pg_try_advisory_xact_lock")) return rows([{ locked: options.locked ?? true }]);
      if (sql.includes("INSERT INTO workbook_sync_runs")) return rows([{ id: "run-1" }]);
      if (sql.includes("FROM organizations o")) {
        return rows([{ name: "Robo Team", teamNumber: 1234, activeEventKey: "2026casj" }]);
      }
      if (sql.includes("WITH roster AS")) {
        return rows([
          { teamKey: "frc254", teamNumber: 254, nickname: "Cheesy Poofs", epaTotal: "61.2", metricsSource: "statbotics", updatedAt: "2026-09-20T00:00:00Z" },
          { teamKey: "frc1678", teamNumber: 1678, nickname: "Citrus", epaTotal: null, metricsSource: null, updatedAt: null },
        ]);
      }
      if (sql.includes("FROM matches_ref")) {
        return rows([
          {
            matchKey: "2026casj_qm1", eventKey: "2026casj", compLevel: "qm", setNumber: 1, matchNumber: 1,
            red: { teamKeys: ["frc254", "frc1", "frc2"], score: 100 }, blue: { teamKeys: ["frc1678", "frc3", "frc4"], score: -1 },
            winningAlliance: "", scheduledTime: null, actualTime: null, placeholder: false, updatedAt: "2026-09-20T00:00:00Z",
          },
        ]);
      }
      if (sql.includes("FROM match_scout_entries")) {
        return rows([
          {
            id: "11111111-0000-4000-8000-000000000001", eventKey: "2026casj", matchKey: "2026casj_qm1", teamKey: "frc254",
            scoutName: "Ada", confidence: "high", source: "manual", createdAt: "2026-09-20T10:00:00Z", updatedAt: "2026-09-20T10:00:00Z",
            payload: { autoPoints: 12, endgame: "climb" },
          },
        ]);
      }
      if (sql.includes("FROM pit_scout_entries")) return rows([]);
      if (sql.includes("FROM pick_lists p")) {
        return rows([
          {
            id: "list-1", orgId: ORG, eventKey: "2026casj", name: "Saturday list", seasonYear: 2026, status: "open",
            source: "manual", boardState: {}, createdBy: USER, updatedBy: USER, updatedByName: "Coach",
            updatedAt: "2026-09-21 18:00:00+00", revision: 3,
          },
        ]);
      }
      if (sql.includes("FROM pick_list_entries e")) {
        return rows([
          {
            id: "entry-1", pickListId: "list-1", teamKey: "frc254", teamNumber: 254, nickname: "Cheesy Poofs", rank: 1,
            bucket: "first_pick", tier: "first", notes: "fast", addedBy: USER, updatedBy: USER, updatedByName: "Coach",
            updatedAt: "2026-09-21 18:00:00.5+00", revision: 1, justification: null, justificationSources: [],
            justificationContradiction: false, justificationReason: null, justificationGeneratedAt: null,
            draftedAllianceSeed: null, draftedPickSlot: null, draftedAt: null, boardRationale: null,
          },
        ]);
      }
      if (sql.includes("FROM pick_list_entry_votes")) return rows([]);
      if (sql.includes("UPDATE workbook_sync_runs") || sql.includes("UPDATE org_microsoft_connections")) return rows([]);
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
  return { client: client as unknown as PoolClient, log };
}

const fixedClock = () => new Date("2026-09-22T12:00:00Z");

describe("syncOrgWorkbook", () => {
  it("is idempotent: syncing twice leaves an identical workbook", async () => {
    const target = new InMemoryWorkbookTarget();
    const first = await syncOrgWorkbook(fakeClient().client, ORG, { openTarget: async () => target, userId: USER, now: fixedClock });
    const afterFirst = target.snapshot();
    const second = await syncOrgWorkbook(fakeClient().client, ORG, { openTarget: async () => target, userId: USER, now: fixedClock });
    expect(first.status).toBe("succeeded");
    expect(second.status).toBe("succeeded");
    expect(target.snapshot()).toBe(afterFirst);
    // Replace, not append: still exactly one match-scouting row and one pick-list row.
    expect(target.tables.get("VantageMatchScouting")!.rows).toHaveLength(1);
    expect(target.tables.get("VantagePickList")!.rows).toHaveLength(1);
    expect(target.closed).toBe(2);
  });

  it("writes the real data it read, keyed by stable ids", async () => {
    const target = new InMemoryWorkbookTarget();
    await syncOrgWorkbook(fakeClient().client, ORG, { openTarget: async () => target, now: fixedClock });
    const teams = target.tables.get("VantageTeams")!;
    expect(teams.rows.map((row) => row[0])).toEqual(["frc254", "frc1678"]);
    expect(teams.rows[0]![teams.columns.indexOf("epa_total")]).toBe(61.2);
    const matches = target.tables.get("VantageMatches")!;
    expect(matches.rows[0]![0]).toBe("2026casj_qm1");
    // TBA's -1 "not played" is not written as a score.
    expect(matches.rows[0]![matches.columns.indexOf("blue_score")]).toBe("");
    const scouting = target.tables.get("VantageMatchScouting")!;
    expect(scouting.columns.slice(-2)).toEqual(["data.autoPoints", "data.endgame"]);
    expect(scouting.rows[0]!.slice(-2)).toEqual([12, "climb"]);
    const picks = target.tables.get("VantagePickList")!;
    expect(picks.rows[0]![0]).toBe("entry-1");
    expect(picks.rows[0]![picks.columns.indexOf("updated_at")]).toBe("2026-09-21T18:00:00Z");
  });

  it("records the run and clears the connection error on success", async () => {
    const { client, log } = fakeClient();
    await syncOrgWorkbook(client, ORG, { openTarget: async () => new InMemoryWorkbookTarget(), userId: USER, now: fixedClock });
    const insert = log.find((q) => q.sql.includes("INSERT INTO workbook_sync_runs"))!;
    expect(insert.params).toEqual([ORG, 1, USER, "2026-09-22T12:00:00.000Z"]);
    const finish = log.find((q) => q.sql.includes("UPDATE workbook_sync_runs"))!;
    expect(finish.params[1]).toBe("succeeded");
    expect(finish.params[4]).toBeGreaterThan(0);
    const conn = log.find((q) => q.sql.includes("UPDATE org_microsoft_connections"))!;
    expect(conn.sql).toContain("last_error = NULL");
  });

  it("marks the run 'partial' and names the failed sheet when one table fails", async () => {
    const target = new InMemoryWorkbookTarget();
    target.failOn.set("VantagePickList", new GraphError("conflict", "merge conflict", 409, "conflict"));
    const { client, log } = fakeClient();
    const result = await syncOrgWorkbook(client, ORG, { openTarget: async () => target, now: fixedClock });
    expect(result.status).toBe("partial");
    if (result.status !== "partial") throw new Error("unreachable");
    expect(result.tablesWritten.PickList).toMatchObject({ ok: false });
    expect(result.tablesWritten.Teams).toMatchObject({ ok: true, rows: 2 });
    expect(result.error).toContain("PickList");
    // Other sheets were still written.
    expect(target.tables.get("VantageSyncInfo")!.rows.length).toBeGreaterThan(0);
    const conn = log.find((q) => q.sql.includes("UPDATE org_microsoft_connections"))!;
    expect(conn.params[2]).toBe("partial");
    expect(String(conn.params[3])).toContain("PickList");
  });

  it("marks the run 'failed' when the workbook cannot be opened, and records why", async () => {
    const { client, log } = fakeClient();
    const result = await syncOrgWorkbook(client, ORG, {
      openTarget: async () => {
        throw new GraphError("throttled", "slow down", 429, "TooManyRequests");
      },
      now: fixedClock,
    });
    expect(result.status).toBe("failed");
    const finish = log.find((q) => q.sql.includes("UPDATE workbook_sync_runs"))!;
    expect(finish.params[1]).toBe("failed");
    expect(String(finish.params[5])).toMatch(/slow down/i);
  });

  it("stops writing after Microsoft says the sign-in is gone", async () => {
    let calls = 0;
    const target: WorkbookTarget = {
      async ensureTable() {
        calls += 1;
        throw new GraphError("auth_expired", "expired", 401);
      },
      async replaceRows() {},
      async close() {},
    };
    const tables = buildWorkbookTables(
      { orgName: "x", teamNumber: 1, activeEventKey: null, teams: [], matches: [], matchScouting: [], pitScouting: [], pickList: [] },
      fixedClock(),
    );
    const outcomes = await writeWorkbookTables(target, tables);
    expect(calls).toBe(1);
    expect(outcomes.every((outcome) => !outcome.ok)).toBe(true);
    expect(summarizeOutcomes(outcomes).status).toBe("failed");
  });

  it("returns busy instead of interleaving with a sync already running for the team", async () => {
    const { client, log } = fakeClient({ locked: false });
    const result = await syncOrgWorkbook(client, ORG, { openTarget: async () => new InMemoryWorkbookTarget() });
    expect(result.status).toBe("busy");
    expect(log.some((q) => q.sql.includes("INSERT INTO workbook_sync_runs"))).toBe(false);
  });

  it("scopes every query to the org and uses parameters, not string-built SQL", async () => {
    const { client, log } = fakeClient();
    await syncOrgWorkbook(client, ORG, { openTarget: async () => new InMemoryWorkbookTarget(), now: fixedClock });
    for (const query of log) expect(query.sql).not.toContain(ORG);
    const scoped = log.filter((q) => /match_scout_entries|pit_scout_entries|workbook_sync_runs|org_microsoft_connections/.test(q.sql));
    for (const query of scoped) expect(query.params).toContain(ORG);
  });
});

describe("summarizeOutcomes", () => {
  it("succeeded / partial / failed", () => {
    expect(summarizeOutcomes([{ entity: "Teams", rows: 2, ok: true }]).status).toBe("succeeded");
    expect(
      summarizeOutcomes([
        { entity: "Teams", rows: 2, ok: true },
        { entity: "Matches", rows: 0, ok: false, error: "x" },
      ]),
    ).toMatchObject({ status: "partial", rowsWritten: 2 });
    expect(summarizeOutcomes([{ entity: "Teams", rows: 0, ok: false, error: "x" }]).status).toBe("failed");
  });
});

describe("normalizeTimestamp", () => {
  it("turns Postgres timestamptz text into ISO UTC", () => {
    expect(normalizeTimestamp("2026-09-21 18:00:00.123+00")).toBe("2026-09-21T18:00:00Z");
    expect(normalizeTimestamp("2026-09-21 20:00:00+02")).toBe("2026-09-21T18:00:00Z");
    expect(normalizeTimestamp(null)).toBeNull();
  });
});
