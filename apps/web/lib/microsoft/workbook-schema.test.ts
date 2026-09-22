import { describe, expect, it } from "vitest";
import {
  MAX_PAYLOAD_COLUMNS,
  PAYLOAD_OVERFLOW_COLUMN,
  type WorkbookSource,
  buildWorkbookTables,
  columnLetter,
  dedupeColumns,
  flattenPayload,
  payloadColumns,
  toCell,
} from "./workbook-schema";

const NOW = new Date("2026-09-22T12:00:00Z");

function source(overrides: Partial<WorkbookSource> = {}): WorkbookSource {
  return {
    orgName: "Robo Team",
    teamNumber: 1234,
    activeEventKey: "2026casj",
    teams: [],
    matches: [],
    matchScouting: [],
    pitScouting: [],
    pickList: [],
    ...overrides,
  };
}

const scout = (id: string, payload: unknown, extra: Record<string, unknown> = {}) => ({
  id,
  eventKey: "2026casj",
  matchKey: "2026casj_qm1",
  teamKey: "frc254",
  scoutName: "Ada",
  confidence: "normal",
  source: "manual",
  createdAt: "2026-09-20T10:00:00Z",
  updatedAt: "2026-09-20T10:05:00Z",
  payload,
  ...extra,
});

describe("payload flattening", () => {
  it("takes the union of keys across rows in stable sorted order", () => {
    const { keys, overflowKeys } = payloadColumns([{ teleop: 1, auto: 2 }, { endgame: "climb", auto: 3 }, null, [1, 2]]);
    expect(keys).toEqual(["auto", "endgame", "teleop"]);
    expect(overflowKeys).toEqual([]);
  });

  it("orders by code unit, not locale (uppercase before lowercase, identical everywhere)", () => {
    expect(payloadColumns([{ b: 1, B: 1, a: 1, _x: 1 }]).keys).toEqual(["B", "_x", "a", "b"]);
  });

  it("caps columns and keeps the rest as JSON in one overflow column", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < MAX_PAYLOAD_COLUMNS + 5; i += 1) wide[`k${String(i).padStart(3, "0")}`] = i;
    const { keys, overflowKeys } = payloadColumns([wide]);
    expect(keys).toHaveLength(MAX_PAYLOAD_COLUMNS);
    expect(overflowKeys).toEqual(["k060", "k061", "k062", "k063", "k064"]);
    const cells = flattenPayload(wide, keys, overflowKeys);
    expect(cells).toHaveLength(MAX_PAYLOAD_COLUMNS + 1);
    expect(JSON.parse(String(cells.at(-1)))).toEqual({ k060: 60, k061: 61, k062: 62, k063: 63, k064: 64 });
  });

  it("writes missing keys as blanks, not null, and nested values as JSON", () => {
    expect(flattenPayload({ a: 1, c: { x: [1] } }, ["a", "b", "c"], [])).toEqual([1, "", '{"x":[1]}']);
  });
});

describe("cell hygiene", () => {
  it("neutralises formula-looking text but leaves numbers and plain text alone", () => {
    expect(toCell("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(toCell("+1+1")).toBe("'+1+1");
    expect(toCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(toCell("-3")).toBe("-3");
    expect(toCell("fast robot")).toBe("fast robot");
    expect(toCell(12.5)).toBe(12.5);
    expect(toCell(Number.NaN)).toBe("");
    expect(toCell(null)).toBe("");
    expect(toCell(true)).toBe(true);
  });

  it("caps text at Excel's cell limit", () => {
    expect(String(toCell("x".repeat(40_000))).length).toBe(32_767);
  });

  it("dedupes header names case-insensitively", () => {
    expect(dedupeColumns(["id", "data.a", "ID", "data.a"])).toEqual(["id", "data.a", "ID_2", "data.a_2"]);
  });

  it("converts column numbers to letters", () => {
    expect([1, 26, 27, 52, 53, 702, 703].map(columnLetter)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
  });
});

describe("workbook tables", () => {
  it("produces one table per entity in a fixed order, each with id / updated_at / source", () => {
    const tables = buildWorkbookTables(source(), NOW);
    expect(tables.map((t) => t.spec.entity)).toEqual(["Teams", "Matches", "MatchScouting", "PitScouting", "PickList", "SyncInfo"]);
    for (const table of tables) {
      expect(table.spec.columns[0]).toBe("id");
      expect(table.spec.columns).toContain("updated_at");
      expect(table.spec.columns).toContain("source");
      expect(table.spec.table).toBe(`Vantage${table.spec.entity}`);
      expect(new Set(table.spec.columns.map((c) => c.toLowerCase())).size).toBe(table.spec.columns.length);
    }
  });

  it("keys match scouting rows by their Postgres uuid and never by position", () => {
    const tables = buildWorkbookTables(
      source({
        matchScouting: [
          scout("bbbbbbbb-0000-4000-8000-000000000002", { auto: 3 }, { matchKey: "2026casj_qm2" }),
          scout("aaaaaaaa-0000-4000-8000-000000000001", { auto: 5, notes: "=cmd" }),
        ],
      }),
      NOW,
    );
    const match = tables.find((t) => t.spec.entity === "MatchScouting")!;
    expect(match.spec.columns).toEqual([
      "id", "event_key", "match_key", "team_key", "team_number", "scout", "confidence", "created_at", "updated_at", "source",
      "data.auto", "data.notes",
    ]);
    // Sorted by match, so qm1 first — and each row carries its own uuid.
    expect(match.rows.map((row) => row[0])).toEqual([
      "aaaaaaaa-0000-4000-8000-000000000001",
      "bbbbbbbb-0000-4000-8000-000000000002",
    ]);
    expect(match.rows[0]!.slice(-2)).toEqual([5, "'=cmd"]);
    expect(match.rows[1]!.slice(-2)).toEqual([3, ""]);
    expect(match.rows[0]![4]).toBe(254);
  });

  it("is deterministic regardless of input order", () => {
    const rows = [
      scout("c", { z: 1 }, { teamKey: "frc9", matchKey: "2026casj_qm3" }),
      scout("a", { a: 1 }, { teamKey: "frc1", matchKey: "2026casj_qm1" }),
      scout("b", { m: 1 }, { teamKey: "frc5", matchKey: "2026casj_qm2" }),
    ];
    const one = buildWorkbookTables(source({ matchScouting: rows }), NOW);
    const two = buildWorkbookTables(source({ matchScouting: [...rows].reverse() }), NOW);
    expect(two).toEqual(one);
  });

  it("uses match_key as the Matches id and orders by level then number", () => {
    const base = {
      eventKey: "2026casj", setNumber: 1, red: ["frc1", "frc2", "frc3"], blue: ["frc4", "frc5", "frc6"],
      redScore: 10, blueScore: 20, winningAlliance: "blue", scheduledTime: null, actualTime: null, placeholder: false, updatedAt: null,
    };
    const tables = buildWorkbookTables(
      source({
        matches: [
          { ...base, matchKey: "2026casj_f1m1", compLevel: "f", matchNumber: 1 },
          { ...base, matchKey: "2026casj_qm10", compLevel: "qm", matchNumber: 10 },
          { ...base, matchKey: "2026casj_qm2", compLevel: "qm", matchNumber: 2 },
        ],
      }),
      NOW,
    );
    const matches = tables.find((t) => t.spec.entity === "Matches")!;
    expect(matches.rows.map((r) => r[0])).toEqual(["2026casj_qm2", "2026casj_qm10", "2026casj_f1m1"]);
    expect(matches.rows[0]!.slice(5, 11)).toEqual(["frc1", "frc2", "frc3", "frc4", "frc5", "frc6"]);
  });

  it("summarises row counts in SyncInfo", () => {
    const tables = buildWorkbookTables(source({ pitScouting: [scout("p1", { drivetrain: "swerve" })] }), NOW);
    const info = tables.at(-1)!;
    const byKey = Object.fromEntries(info.rows.map((row) => [row[0], row[1]]));
    expect(byKey["rows.PitScouting"]).toBe(1);
    expect(byKey["synced_at"]).toBe("2026-09-22T12:00:00.000Z");
    expect(byKey["team_number"]).toBe(1234);
    expect(byKey["active_event_key"]).toBe("2026casj");
  });

  it("an overflow column only appears when there is overflow", () => {
    const tables = buildWorkbookTables(source({ pitScouting: [scout("p1", { a: 1 })] }), NOW);
    expect(tables.find((t) => t.spec.entity === "PitScouting")!.spec.columns).not.toContain(PAYLOAD_OVERFLOW_COLUMN);
  });
});
