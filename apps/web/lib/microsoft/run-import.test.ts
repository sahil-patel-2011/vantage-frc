import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import { GraphError } from "./graph";
import { applyWorkbookImport, buildImportPreview, loadImportSource, toPublicPreview } from "./run-import";
import type { ImportEntity, WorkbookReader, WorkbookTableRead, WorkbookTableRef } from "./workbook-import";
import { type CellValue, buildMatchScoutingTable, buildPickListTable, buildPitScoutingTable } from "./workbook-schema";

// ---------------------------------------------------------------------------
// TEST-ONLY in-memory WorkbookReader. Never used by product code: the real reader is
// GraphWorkbookTarget.readTable (workbook-target.ts). It models "a workbook of named
// tables" so preview and apply can be checked without Microsoft.
// ---------------------------------------------------------------------------
class InMemoryWorkbookReader implements WorkbookReader {
  readonly tables = new Map<string, WorkbookTableRead>();
  closed = 0;
  failWith: Error | null = null;

  async readTable(ref: WorkbookTableRef): Promise<WorkbookTableRead | null> {
    if (this.failWith) throw this.failWith;
    const table = this.tables.get(ref.table);
    return table ? { headers: [...table.headers], rows: table.rows.map((row) => [...row]) } : null;
  }

  async close() {
    this.closed += 1;
  }

  set(table: string, header: string, id: string, value: unknown) {
    const t = this.tables.get(table)!;
    t.rows.find((row) => row[0] === id)![t.headers.indexOf(header)] = value;
  }
}

const ORG = "6925a000-0000-4000-8000-000000000001";
const USER = "6925a000-0000-4000-8000-000000000002";
const LIST = "a0000000-0000-4000-8000-000000000001";
const P1 = "b0000000-0000-4000-8000-000000000001";
const P2 = "b0000000-0000-4000-8000-000000000002";
const M1 = "c0000000-0000-4000-8000-000000000001";
const M2 = "c0000000-0000-4000-8000-000000000002";
const SCHEMA = "e0000000-0000-4000-8000-000000000001";

const P1_VERSION = "2026-09-21 18:00:00.123456+00";
const P2_VERSION = "2026-09-21 18:00:00.2+00";
const M_VERSION = "2026-09-21 18:00:00.5+00";

type Recorded = { sql: string; params: unknown[] };

function fakeClient(options: {
  migrated?: boolean;
  locked?: boolean;
  /** Scouting rows whose guarded UPDATE finds nothing (changed since the preview). */
  movedOn?: string[];
  /** Pick-list updated_at text the FOR UPDATE read returns for P1 (defaults to unchanged). */
  p1LockedVersion?: string;
} = {}) {
  const log: Recorded[] = [];
  const client = {
    async query(sql: string, params: unknown[] = []) {
      log.push({ sql, params });
      const rows = (r: unknown[], rowCount = r.length) => ({ rows: r, rowCount });
      if (sql.includes("to_regclass")) return rows([{ ready: options.migrated ?? true }]);
      if (sql.includes("pg_try_advisory_xact_lock")) return rows([{ locked: options.locked ?? true }]);
      if (sql.includes("FROM org_active_context")) return rows([{ activeEventKey: "2026casj" }]);
      if (sql.startsWith("UPDATE match_scout_entries") || sql.includes("UPDATE match_scout_entries")) {
        return rows([], (options.movedOn ?? []).includes(String(params[0])) ? 0 : 1);
      }
      if (sql.includes("FROM match_scout_entries e")) {
        return rows([
          {
            id: M1, eventKey: "2026casj", matchKey: "2026casj_qm1", teamKey: "frc254", scoutName: "Ada",
            confidence: "normal", source: "manual", createdAt: "2026-09-21T17:00:00Z", updatedAt: "2026-09-21T18:00:00Z",
            version: M_VERSION, schemaId: SCHEMA, payload: { autoPoints: 12, endgame: "climb" }, inScope: true,
          },
          {
            id: M2, eventKey: "2026casj", matchKey: "2026casj_qm2", teamKey: "frc1678", scoutName: "Grace",
            confidence: "high", source: "manual", createdAt: "2026-09-21T17:00:00Z", updatedAt: "2026-09-21T18:00:00Z",
            version: M_VERSION, schemaId: SCHEMA, payload: { autoPoints: 4, endgame: "park" }, inScope: true,
          },
        ]);
      }
      if (sql.includes("FROM pit_scout_entries e")) return rows([]);
      if (sql.includes("FROM scout_schemas")) {
        return rows([
          {
            id: SCHEMA,
            definition: {
              title: "Match",
              fields: [
                { key: "autoPoints", label: "Auto points", type: "number" },
                { key: "endgame", label: "Endgame", type: "select", options: ["climb", "park", "none"] },
              ],
            },
          },
        ]);
      }
      if (sql.includes("SELECT status FROM pick_lists")) return rows([{ status: "open" }]);
      if (sql.includes("FROM pick_lists p")) {
        return rows([
          {
            id: LIST, orgId: ORG, eventKey: "2026casj", name: "Saturday list", seasonYear: 2026, status: "open",
            source: "manual", boardState: {}, createdBy: USER, updatedBy: USER, updatedByName: "Coach",
            updatedAt: "2026-09-21 18:00:00+00", revision: 3,
          },
        ]);
      }
      if (sql.includes("FOR UPDATE") && sql.includes("pick_list_entries")) {
        return rows([
          { id: P1, rank: 1, bucket: "first_pick", teamNumber: 254, updatedAt: options.p1LockedVersion ?? P1_VERSION },
          { id: P2, rank: 2, bucket: "first_pick", teamNumber: 1678, updatedAt: P2_VERSION },
        ]);
      }
      if (sql.includes("FROM pick_list_entry_votes")) return rows([]);
      if (sql.includes("FROM pick_list_entries e")) {
        const entry = (id: string, rank: number, team: number, version: string, notes: string | null) => ({
          id, pickListId: LIST, teamKey: `frc${team}`, teamNumber: team, nickname: null, rank, bucket: "first_pick",
          tier: "first", notes, addedBy: USER, updatedBy: USER, updatedByName: "Coach", updatedAt: version, revision: 1,
          justification: null, justificationSources: [], justificationContradiction: false, justificationReason: null,
          justificationGeneratedAt: null, draftedAllianceSeed: null, draftedPickSlot: null, draftedAt: null, boardRationale: null,
        });
        return rows([entry(P1, 1, 254, P1_VERSION, "fast"), entry(P2, 2, 1678, P2_VERSION, null)]);
      }
      if (sql.includes("UPDATE pick_list_entries") || sql.includes("UPDATE pick_lists")) return rows([], 1);
      if (sql.includes("INSERT INTO workbook_import_runs")) return rows([{ id: "import-run-1" }]);
      throw new Error(`unexpected query: ${sql.slice(0, 90)}`);
    },
  };
  return { client: client as unknown as PoolClient, log };
}

/** The workbook exactly as Sync now would have written it from the fake database. */
async function syncedWorkbook(): Promise<InMemoryWorkbookReader> {
  const { client } = fakeClient();
  const source = await loadImportSource(client, ORG, {});
  const ws = {
    orgName: "", teamNumber: null, activeEventKey: source.activeEventKey, teams: [], matches: [],
    matchScouting: source.matchScouting, pitScouting: source.pitScouting, pickList: source.pickEntries,
  };
  const reader = new InMemoryWorkbookReader();
  for (const built of [buildPickListTable(ws), buildMatchScoutingTable(ws), buildPitScoutingTable(ws)]) {
    reader.tables.set(built.spec.table, { headers: [...built.spec.columns], rows: built.rows.map((r: CellValue[]) => [...r]) });
  }
  return reader;
}

async function previewIds(reader: InMemoryWorkbookReader) {
  const { client } = fakeClient();
  const reads: Partial<Record<ImportEntity, WorkbookTableRead | null>> = {
    PickList: await reader.readTable({ entity: "PickList", sheet: "PickList", table: "VantagePickList" }),
    MatchScouting: await reader.readTable({ entity: "MatchScouting", sheet: "MatchScouting", table: "VantageMatchScouting" }),
    PitScouting: await reader.readTable({ entity: "PitScouting", sheet: "PitScouting", table: "VantagePitScouting" }),
  };
  const { preview } = await buildImportPreview(client, ORG, reads);
  return preview;
}

function runInsert(log: Recorded[]) {
  const insert = log.find((entry) => entry.sql.includes("INSERT INTO workbook_import_runs"));
  if (!insert) return null;
  const [orgId, status, startedBy, , applied, conflicts, skipped, summary, error] = insert.params;
  return { orgId, status, startedBy, applied, conflicts, skipped, summary: JSON.parse(String(summary)), error };
}

describe("import preview (in-memory workbook)", () => {
  it("is empty for a freshly synced workbook", async () => {
    const preview = await previewIds(await syncedWorkbook());
    expect(preview.totals.changes).toBe(0);
    expect(preview.totals.conflicts).toBe(0);
    expect(preview.tables.find((t) => t.entity === "PitScouting")!.found).toBe(true);
  });

  it("checks scouting answers against the entry's form", async () => {
    const reader = await syncedWorkbook();
    reader.set("VantageMatchScouting", "data.endgame", M1, "fly");
    reader.set("VantageMatchScouting", "data.endgame", M2, "none");
    const preview = await previewIds(reader);
    const match = preview.tables.find((t) => t.entity === "MatchScouting")!;
    expect(match.invalid).toMatchObject([{ rowId: M1, field: "data.endgame", reason: "Endgame has an invalid option" }]);
    expect(match.changes.map((c) => [c.rowId, c.value])).toEqual([[M2, "none"]]);
  });

  it("gives the browser counts and short lists, never row versions or typed values", async () => {
    const reader = await syncedWorkbook();
    reader.set("VantagePickList", "notes", P2, "solid");
    const preview = toPublicPreview(await previewIds(reader));
    const change = preview.tables[0]!.changes[0]!;
    expect(Object.keys(change).sort()).toEqual(["entity", "field", "from", "id", "label", "to"]);
    expect(JSON.stringify(preview)).not.toContain(P2_VERSION);
  });
});

describe("applyWorkbookImport", () => {
  it("writes only the confirmed changes, through the pick-list store and the guarded scouting UPDATE", async () => {
    const reader = await syncedWorkbook();
    reader.set("VantagePickList", "notes", P2, "solid auto");
    reader.set("VantagePickList", "rank", P2, 1);
    reader.set("VantageMatchScouting", "data.autoPoints", M1, 20);
    reader.set("VantageMatchScouting", "confidence", M1, "high");
    reader.set("VantageMatchScouting", "data.autoPoints", M2, 5); // previewed but not confirmed
    const preview = await previewIds(reader);
    const confirmed = preview.tables
      .flatMap((t) => t.changes)
      .filter((c) => c.rowId !== M2)
      .map((c) => c.id);
    expect(confirmed).toHaveLength(4);

    const { client, log } = fakeClient();
    const result = await applyWorkbookImport(client, {
      orgId: ORG, userId: USER, changeIds: confirmed, openReader: async () => reader, now: () => new Date("2026-09-22T12:00:00Z"),
    });
    expect(result).toEqual({
      status: "applied", runId: "import-run-1", applied: 4, conflicts: 0, skipped: 1, stale: 0, lateConflicts: 0,
    });
    expect(reader.closed).toBe(1);

    const scoutUpdates = log.filter((entry) => entry.sql.includes("UPDATE match_scout_entries"));
    expect(scoutUpdates).toHaveLength(1);
    expect(scoutUpdates[0]!.params).toEqual([M1, ORG, JSON.stringify({ autoPoints: 20 }), "high", M_VERSION]);
    expect(scoutUpdates[0]!.sql).toContain("updated_at = $5::timestamptz");
    expect(scoutUpdates[0]!.sql).toContain("scout_user_id = current_app_user_id() OR has_org_role");

    const notes = log.find((entry) => entry.sql.includes("UPDATE pick_list_entries") && entry.sql.includes("notes ="))!;
    expect(notes.params).toEqual([ORG, LIST, P2, null, null, true, "solid auto", USER]);
    const ranks = log.find((entry) => entry.sql.includes("unnest($2::uuid[])"))!;
    expect(ranks.params).toEqual([LIST, [P2, P1], [1, 2], USER]);
    expect(log.some((entry) => entry.sql.includes("FOR UPDATE"))).toBe(true);

    const run = runInsert(log)!;
    expect(run).toMatchObject({ orgId: ORG, status: "applied", startedBy: USER, applied: 4, conflicts: 0, skipped: 1, error: null });
    expect(run.summary.tables.PickList).toMatchObject({ applied: 2, rows: [P2], fields: ["rank", "notes"] });
    expect(run.summary.tables.MatchScouting).toMatchObject({ applied: 2, rows: [M1] });
    // Row ids and column names only: no cell contents in the audit row.
    expect(JSON.stringify(run.summary)).not.toMatch(/solid auto|"20"|high/);
  });

  it("turns a row that changed after the preview into a conflict instead of overwriting it", async () => {
    const reader = await syncedWorkbook();
    reader.set("VantageMatchScouting", "data.autoPoints", M1, 20);
    reader.set("VantagePickList", "notes", P1, "edited in excel");
    const ids = (await previewIds(reader)).tables.flatMap((t) => t.changes).map((c) => c.id);
    const { client, log } = fakeClient({ movedOn: [M1], p1LockedVersion: "2026-09-22 09:00:00+00" });
    const result = await applyWorkbookImport(client, { orgId: ORG, userId: USER, changeIds: ids, openReader: async () => reader });
    expect(result).toMatchObject({ status: "nothing_applied", applied: 0, conflicts: 2, lateConflicts: 2 });
    expect(log.some((entry) => entry.sql.includes("notes = CASE"))).toBe(false);
    expect(runInsert(log)).toMatchObject({ status: "nothing_applied", applied: 0, conflicts: 2 });
  });

  it("counts confirmed ids that no longer match the workbook as stale, and applies nothing for them", async () => {
    const reader = await syncedWorkbook();
    reader.set("VantageMatchScouting", "data.autoPoints", M1, 20);
    const ids = (await previewIds(reader)).tables.flatMap((t) => t.changes).map((c) => c.id);
    reader.set("VantageMatchScouting", "data.autoPoints", M1, 21); // edited again after the preview
    const { client, log } = fakeClient();
    const result = await applyWorkbookImport(client, { orgId: ORG, userId: USER, changeIds: ids, openReader: async () => reader });
    expect(result).toMatchObject({ status: "nothing_applied", applied: 0, stale: 1 });
    expect(log.some((entry) => entry.sql.includes("UPDATE match_scout_entries"))).toBe(false);
  });

  it("returns busy while a sync or another import holds the team's lock", async () => {
    const { client, log } = fakeClient({ locked: false });
    const result = await applyWorkbookImport(client, { orgId: ORG, userId: USER, changeIds: ["x"], openReader: async () => new InMemoryWorkbookReader() });
    expect(result).toEqual({ status: "busy" });
    expect(runInsert(log)).toBeNull();
  });

  it("refuses to run before migration 0676", async () => {
    const { client } = fakeClient({ migrated: false });
    const result = await applyWorkbookImport(client, { orgId: ORG, userId: USER, changeIds: ["x"], openReader: async () => new InMemoryWorkbookReader() });
    expect(result).toEqual({ status: "not_migrated" });
  });

  it("records a failed run when Microsoft cannot be read, and writes nothing", async () => {
    const reader = await syncedWorkbook();
    reader.failWith = new GraphError("throttled", "Microsoft is rate-limiting this workbook.", 429);
    const { client, log } = fakeClient();
    const result = await applyWorkbookImport(client, { orgId: ORG, userId: USER, changeIds: ["x"], openReader: async () => reader });
    expect(result).toMatchObject({ status: "failed", runId: "import-run-1" });
    expect(runInsert(log)).toMatchObject({ status: "failed", applied: 0 });
    expect(log.some((entry) => /UPDATE (match_scout_entries|pick_list_entries)/.test(entry.sql))).toBe(false);
    expect(reader.closed).toBe(1);
  });
});
