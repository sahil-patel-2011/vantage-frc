import { describe, expect, it } from "vitest";
import {
  type ImportEntity,
  type ImportSource,
  type PickImportRow,
  type ScoutImportRow,
  type WorkbookTableRead,
  decodeCellAs,
  diffWorkbook,
  normalizeWorkbookTimestamp,
  parseBucket,
  sameCell,
  unescapeCell,
  workbookColumnValues,
} from "./workbook-import";
import {
  type CellValue,
  type WorkbookSource,
  buildMatchScoutingTable,
  buildPickListTable,
  buildPitScoutingTable,
  toCell,
} from "./workbook-schema";

// ------------------------------------------------------------------ fixtures

const T0 = "2026-09-21T18:00:00Z";
const T1 = "2026-09-21T19:30:00Z";
const LIST = "a0000000-0000-4000-8000-000000000001";
const P1 = "b0000000-0000-4000-8000-000000000001";
const P2 = "b0000000-0000-4000-8000-000000000002";
const P3 = "b0000000-0000-4000-8000-000000000003";
const M1 = "c0000000-0000-4000-8000-000000000001";
const M2 = "c0000000-0000-4000-8000-000000000002";
const S1 = "d0000000-0000-4000-8000-000000000001";
const SCHEMA = "e0000000-0000-4000-8000-000000000001";

function pick(id: string, rank: number, teamNumber: number, extra: Partial<PickImportRow> = {}): PickImportRow {
  return {
    id,
    pickListId: LIST,
    listName: "Saturday list",
    listStatus: "open",
    listSource: "manual",
    eventKey: "2026casj",
    rank,
    teamKey: `frc${teamNumber}`,
    teamNumber,
    nickname: teamNumber === 254 ? "Cheesy Poofs" : null,
    bucket: "first_pick",
    tier: "first",
    notes: null,
    weightedScore: 2,
    voteCount: 1,
    draftedAllianceSeed: null,
    draftedPickSlot: null,
    updatedByName: "Coach",
    updatedAt: T0,
    version: "2026-09-21 18:00:00.123456+00",
    inScope: true,
    ...extra,
  };
}

function scout(id: string, payload: unknown, extra: Partial<ScoutImportRow> = {}): ScoutImportRow {
  return {
    id,
    eventKey: "2026casj",
    matchKey: "2026casj_qm12",
    teamKey: "frc254",
    scoutName: "Ada",
    confidence: "normal",
    source: "manual",
    createdAt: "2026-09-21T17:00:00Z",
    updatedAt: T0,
    payload,
    schemaId: SCHEMA,
    version: "2026-09-21 18:00:00.5+00",
    inScope: true,
    ...extra,
  };
}

function makeSource(partial: Partial<ImportSource> = {}): ImportSource {
  return {
    activeEventKey: "2026casj",
    pickList: { id: LIST, name: "Saturday list", status: "open" },
    pickEntries: [pick(P1, 1, 254, { notes: "fast cycles" }), pick(P2, 2, 1678), pick(P3, 3, 971, { bucket: "second_pick", tier: "second" })],
    matchScouting: [
      scout(M1, { autoPoints: 12, endgame: "climb", note: "=HYPERLINK(\"x\")", defense: true, codes: "007" }),
      scout(M2, { autoPoints: 4, endgame: "park" }, { matchKey: "2026casj_qm13", teamKey: "frc1678" }),
    ],
    pitScouting: [scout(S1, { drivetrain: "swerve", weight: 115 }, { matchKey: undefined })],
    ...partial,
  };
}

function wbSource(source: ImportSource): WorkbookSource {
  return {
    orgName: "",
    teamNumber: null,
    activeEventKey: source.activeEventKey,
    teams: [],
    matches: [],
    matchScouting: source.matchScouting,
    pitScouting: source.pitScouting,
    pickList: source.pickEntries,
  };
}

/** Exactly what the sync would write for this source (the same builders). */
function exported(source: ImportSource): Record<ImportEntity, WorkbookTableRead> {
  const ws = wbSource(source);
  const toRead = (table: { spec: { columns: string[] }; rows: CellValue[][] }): WorkbookTableRead => ({
    headers: [...table.spec.columns],
    rows: table.rows.map((row) => [...row]),
  });
  return {
    PickList: toRead(buildPickListTable(ws)),
    MatchScouting: toRead(buildMatchScoutingTable(ws)),
    PitScouting: toRead(buildPitScoutingTable(ws)),
  };
}

function setCell(read: WorkbookTableRead, id: string, header: string, value: unknown) {
  const col = read.headers.indexOf(header);
  if (col < 0) throw new Error(`no column ${header}`);
  const row = read.rows.find((r) => r[0] === id);
  if (!row) throw new Error(`no row ${id}`);
  row[col] = value;
}

function table(preview: ReturnType<typeof diffWorkbook>, entity: ImportEntity) {
  return preview.tables.find((t) => t.entity === entity)!;
}

// ------------------------------------------------------------------ cell semantics

describe("unescapeCell (the exact inverse of toCell's formula guard)", () => {
  it("strips the apostrophe only where toCell added one", () => {
    for (const text of ["=HYPERLINK(\"x\")", "+1 bonus", "-fast", "@scout", "\tindented", "\rcr"]) {
      expect(toCell(text)).toBe(`'${text}`);
      expect(unescapeCell(toCell(text) as string)).toBe(text);
    }
  });

  it("leaves text toCell never guards alone", () => {
    expect(unescapeCell("'hello")).toBe("'hello");
    expect(unescapeCell("'-3")).toBe("'-3");
    expect(unescapeCell("'12.5")).toBe("'12.5");
    expect(unescapeCell("plain")).toBe("plain");
    expect(unescapeCell("-3")).toBe("-3");
  });
});

describe("sameCell", () => {
  it("treats Excel's re-typing as unchanged", () => {
    expect(sameCell("3", 3)).toBe(true);
    expect(sameCell("007", 7)).toBe(true);
    expect(sameCell(12, 12.0000000000001)).toBe(true);
    expect(sameCell(true, "TRUE")).toBe(true);
    expect(sameCell("", null)).toBe(true);
    expect(sameCell(null, "")).toBe(true);
    expect(sameCell("'=SUM(A1)", "=SUM(A1)")).toBe(true);
    expect(sameCell("'=SUM(A1)", "'=SUM(A1)")).toBe(true);
    expect(sameCell("a\r\nb", "a\nb")).toBe(true);
  });

  it("sees real edits", () => {
    expect(sameCell(3, 4)).toBe(false);
    expect(sameCell("climb", "Climb")).toBe(false);
    expect(sameCell("", 0)).toBe(false);
    expect(sameCell(0, "")).toBe(false);
    expect(sameCell(true, false)).toBe(false);
    expect(sameCell("fast ", "fast")).toBe(false);
  });
});

describe("decodeCellAs", () => {
  it("keeps the stored value's type", () => {
    expect(decodeCellAs(13, 12)).toEqual({ ok: true, value: 13 });
    expect(decodeCellAs("13", 12)).toEqual({ ok: true, value: 13 });
    expect(decodeCellAs("thirteen", 12)).toEqual({ ok: false, reason: "This needs a number." });
    expect(decodeCellAs("false", true)).toEqual({ ok: true, value: false });
    expect(decodeCellAs("maybe", true)).toMatchObject({ ok: false });
    expect(decodeCellAs(5, "climb")).toEqual({ ok: true, value: "5" });
    expect(decodeCellAs(true, "yes")).toEqual({ ok: true, value: "true" });
    expect(decodeCellAs("'=1+1", "x")).toEqual({ ok: true, value: "=1+1" });
  });

  it("blank means no data; a missing value takes Excel's type", () => {
    expect(decodeCellAs("", 12)).toEqual({ ok: true, value: null });
    expect(decodeCellAs(null, "x")).toEqual({ ok: true, value: null });
    expect(decodeCellAs(3, undefined)).toEqual({ ok: true, value: 3 });
    expect(decodeCellAs("3", undefined)).toEqual({ ok: true, value: "3" });
  });

  it("refuses Excel error values", () => {
    expect(decodeCellAs("#N/A", 12)).toMatchObject({ ok: false });
    expect(decodeCellAs("#DIV/0!", "x")).toMatchObject({ ok: false });
  });
});

describe("normalizeWorkbookTimestamp", () => {
  it("reads what the export wrote, and what Excel may have turned it into", () => {
    expect(normalizeWorkbookTimestamp("2026-09-21T18:00:00Z")).toBe(T0);
    expect(normalizeWorkbookTimestamp("2026-09-21 18:00:00")).toBe(T0);
    expect(normalizeWorkbookTimestamp("2026-09-21T18:00:00.999Z")).toBe(T0);
    // 2026-09-21T18:00:00Z as an Excel serial date.
    const serial = Date.UTC(2026, 8, 21, 18) / 86_400_000 + 25569;
    expect(normalizeWorkbookTimestamp(serial)).toBe(T0);
    expect(normalizeWorkbookTimestamp("")).toBeNull();
    expect(normalizeWorkbookTimestamp("yesterday")).toBeNull();
    expect(normalizeWorkbookTimestamp(null)).toBeNull();
  });
});

describe("parseBucket", () => {
  it("accepts the stored value or its label", () => {
    expect(parseBucket("first_pick")).toBe("first_pick");
    expect(parseBucket("Second pick")).toBe("second_pick");
    expect(parseBucket("AVOID")).toBe("avoid");
    expect(parseBucket("first-pick")).toBe("first_pick");
    expect(parseBucket("maybe")).toBeNull();
    expect(parseBucket(1)).toBeNull();
  });
});

// ------------------------------------------------------------------ the diff

describe("diffWorkbook", () => {
  it("finds nothing in a workbook that matches Postgres", () => {
    const source = makeSource();
    const preview = diffWorkbook(exported(source), source);
    expect(preview.totals).toEqual({
      changes: 0,
      conflicts: 0,
      readOnlyEdits: 0,
      invalid: 0,
      unmatched: 0,
      notInWorkbook: 0,
      withoutId: 0,
      duplicateIds: 0,
    });
    expect(preview.tables.every((t) => t.found && t.notice === null)).toBe(true);
    expect(table(preview, "PickList").rowsRead).toBe(3);
  });

  it("still matches when Excel has retyped cells (numbers, booleans, apostrophes, dates)", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.MatchScouting, M1, "data.codes", 7); // "007" typed as a number
    setCell(reads.MatchScouting, M1, "data.defense", "TRUE");
    setCell(reads.MatchScouting, M1, "data.note", "=HYPERLINK(\"x\")"); // apostrophe dropped on read
    setCell(reads.MatchScouting, M1, "updated_at", Date.UTC(2026, 8, 21, 18) / 86_400_000 + 25569);
    setCell(reads.PickList, P1, "rank", "1");
    expect(diffWorkbook(reads, source).totals.changes).toBe(0);
  });

  it("reports pick-list rank, bucket and notes edits with typed values and stable ids", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.PickList, P2, "rank", 1);
    setCell(reads.PickList, P2, "bucket", "Second pick");
    setCell(reads.PickList, P1, "notes", "  fast cycles, weak defense ");
    setCell(reads.PickList, P3, "notes", "'=ok"); // guarded formula-looking text
    const preview = diffWorkbook(reads, source);
    const changes = table(preview, "PickList").changes;
    expect(changes.map((c) => [c.rowId, c.field, c.from, c.value])).toEqual([
      [P1, "notes", "fast cycles", "fast cycles, weak defense"],
      [P2, "rank", 2, 1],
      [P2, "bucket", "first_pick", "second_pick"],
      [P3, "notes", "", "=ok"],
    ]);
    expect(changes[1]!.label).toBe("Team 1678");
    expect(changes[0]!.label).toBe("Team 254 (Cheesy Poofs)");
    expect(changes[0]!.version).toBe("2026-09-21 18:00:00.123456+00");
    // Deterministic: the same workbook gives the same ids; a different value a different id.
    expect(diffWorkbook(reads, source).tables[0]!.changes.map((c) => c.id)).toEqual(changes.map((c) => c.id));
    setCell(reads.PickList, P2, "rank", 3);
    const again = table(diffWorkbook(reads, source), "PickList").changes.find((c) => c.field === "rank")!;
    expect(again.id).not.toBe(changes[1]!.id);
  });

  it("clears notes on a blank cell and refuses bad ranks, buckets and over-long notes", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.PickList, P1, "notes", "");
    setCell(reads.PickList, P2, "rank", 2.5);
    setCell(reads.PickList, P2, "bucket", "maybe");
    setCell(reads.PickList, P3, "rank", 0);
    setCell(reads.PickList, P3, "notes", "x".repeat(2001));
    const t = table(diffWorkbook(reads, source), "PickList");
    expect(t.changes.map((c) => [c.rowId, c.field, c.value])).toEqual([[P1, "notes", null]]);
    expect(t.invalid.map((n) => [n.rowId, n.field])).toEqual([
      [P2, "rank"],
      [P2, "bucket"],
      [P3, "rank"],
      [P3, "notes"],
    ]);
    expect(t.invalid[0]!.reason).toMatch(/whole number/);
  });

  it("reports edits to read-only columns and never turns them into changes", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.PickList, P1, "team_key", "frc9999");
    setCell(reads.PickList, P1, "weighted_score", 99);
    setCell(reads.PickList, P1, "tier", "avoid");
    setCell(reads.MatchScouting, M1, "event_key", "2026xxxx");
    setCell(reads.MatchScouting, M1, "source", "voice");
    setCell(reads.MatchScouting, M1, "created_at", "2020-01-01T00:00:00Z");
    const preview = diffWorkbook(reads, source);
    expect(preview.totals.changes).toBe(0);
    expect(table(preview, "PickList").readOnlyEdits.map((n) => n.field)).toEqual(["team_key", "tier", "weighted_score"]);
    expect(table(preview, "MatchScouting").readOnlyEdits.map((n) => n.field)).toEqual(["event_key", "created_at", "source"]);
    expect(table(preview, "PickList").readOnlyEdits[0]).toMatchObject({ from: "frc254", to: "frc9999" });
  });

  it("makes every edit on a row a conflict when Vantage changed it after the export", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.PickList, P1, "notes", "coach note");
    setCell(reads.PickList, P1, "team_key", "frc1");
    // Someone re-ranked in Vantage after the sync.
    source.pickEntries[0] = { ...source.pickEntries[0]!, updatedAt: T1, version: "2026-09-21 19:30:00+00" };
    const t = table(diffWorkbook(reads, source), "PickList");
    expect(t.changes).toEqual([]);
    expect(t.readOnlyEdits).toEqual([]);
    expect(t.conflicts).toEqual([
      { entity: "PickList", rowId: P1, label: "Team 254 (Cheesy Poofs)", fields: ["notes"], workbookUpdatedAt: T0, vantageUpdatedAt: T1 },
    ]);
  });

  it("treats a cleared or garbled updated_at as a conflict, and an untouched stale row as nothing", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.MatchScouting, M1, "data.autoPoints", 20);
    setCell(reads.MatchScouting, M1, "updated_at", "");
    // M2 is older in the workbook than in Vantage but nobody typed in it.
    source.matchScouting[1] = { ...source.matchScouting[1]!, updatedAt: T1 };
    const t = table(diffWorkbook(reads, source), "MatchScouting");
    expect(t.changes).toEqual([]);
    expect(t.conflicts.map((c) => [c.rowId, c.workbookUpdatedAt])).toEqual([[M1, null]]);
  });

  it("imports scouting answers with the stored types, including blanks and formula-guarded text", () => {
    const source = makeSource();
    const reads = exported(source);
    expect(reads.MatchScouting.rows.find((r) => r[0] === M1)![reads.MatchScouting.headers.indexOf("data.note")]).toBe(
      "'=HYPERLINK(\"x\")",
    );
    setCell(reads.MatchScouting, M1, "data.autoPoints", 13);
    setCell(reads.MatchScouting, M1, "data.endgame", 5);
    setCell(reads.MatchScouting, M1, "data.defense", false);
    setCell(reads.MatchScouting, M1, "data.note", "'-dropped a game piece");
    setCell(reads.MatchScouting, M2, "data.autoPoints", "");
    setCell(reads.MatchScouting, M2, "data.note", "new note"); // key absent on this row until now
    setCell(reads.MatchScouting, M2, "confidence", "High");
    const t = table(diffWorkbook(reads, source), "MatchScouting");
    expect(t.changes.map((c) => [c.rowId, c.field, c.payloadKey, c.value])).toEqual([
      [M1, "data.autoPoints", "autoPoints", 13],
      [M1, "data.defense", "defense", false],
      [M1, "data.endgame", "endgame", "5"],
      [M1, "data.note", "note", "-dropped a game piece"],
      [M2, "confidence", undefined, "high"],
      [M2, "data.autoPoints", "autoPoints", null],
      [M2, "data.note", "note", "new note"],
    ]);
    expect(t.changes.find((c) => c.field === "data.note" && c.rowId === M1)!.from).toBe("=HYPERLINK(\"x\")");
    expect(t.changes[4]!.label).toBe("qm13 · Team 1678 · Ada");
  });

  it("refuses values of the wrong type, bad confidence, and Excel errors", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.MatchScouting, M1, "data.autoPoints", "a dozen");
    setCell(reads.MatchScouting, M1, "data.defense", "sometimes");
    setCell(reads.MatchScouting, M1, "confidence", "certain");
    setCell(reads.MatchScouting, M2, "data.endgame", "#REF!");
    const t = table(diffWorkbook(reads, source), "MatchScouting");
    expect(t.changes).toEqual([]);
    expect(t.invalid.map((n) => [n.rowId, n.field])).toEqual([
      [M1, "confidence"],
      [M1, "data.autoPoints"],
      [M1, "data.defense"],
      [M2, "data.endgame"],
    ]);
  });

  it("runs scouting answers through the entry's form check (which may coerce or refuse)", () => {
    const source = makeSource();
    const reads = exported(source);
    setCell(reads.PitScouting, S1, "data.weight", 120);
    setCell(reads.PitScouting, S1, "data.drivetrain", "hovercraft");
    const seen: string[] = [];
    const preview = diffWorkbook(reads, source, {
      checkScoutField: ({ entity, schemaId, key, value }) => {
        seen.push(`${entity}:${schemaId}:${key}`);
        return key === "drivetrain" ? { ok: false, reason: "Drivetrain must be one of the listed options" } : { ok: true, value };
      },
    });
    const t = table(preview, "PitScouting");
    expect(seen).toEqual([`PitScouting:${SCHEMA}:drivetrain`, `PitScouting:${SCHEMA}:weight`]);
    expect(t.changes.map((c) => [c.field, c.value])).toEqual([["data.weight", 120]]);
    expect(t.invalid).toMatchObject([{ field: "data.drivetrain", reason: "Drivetrain must be one of the listed options" }]);
    expect(t.changes[0]!.label).toBe("Pit · Team 254 · Ada");
  });

  it("keeps data._more and multi-part answers read-only", () => {
    const many: Record<string, number> = {};
    for (let i = 0; i < 62; i += 1) many[`f${String(i).padStart(2, "0")}`] = i;
    const source = makeSource({
      matchScouting: [scout(M1, { ...many, cycles: { amp: 2, speaker: 5 } })],
    });
    const reads = exported(source);
    expect(reads.MatchScouting.headers.at(-1)).toBe("data._more");
    setCell(reads.MatchScouting, M1, "data._more", "{}");
    setCell(reads.MatchScouting, M1, "data.cycles", "{\"amp\":9}");
    setCell(reads.MatchScouting, M1, "data.f00", 100);
    const t = table(diffWorkbook(reads, source), "MatchScouting");
    expect(t.changes.map((c) => [c.field, c.value])).toEqual([["data.f00", 100]]);
    expect(t.readOnlyEdits.map((n) => n.field).sort()).toEqual(["data._more", "data.cycles"]);
  });

  it("maps de-duplicated payload headers back to the right key", () => {
    const source = makeSource({ matchScouting: [scout(M1, { Speed: 3, speed: 4 })] });
    const reads = exported(source);
    expect(reads.MatchScouting.headers).toContain("data.speed_2");
    setCell(reads.MatchScouting, M1, "data.speed_2", 5);
    const t = table(diffWorkbook(reads, source), "MatchScouting");
    expect(t.changes.map((c) => [c.field, c.payloadKey, c.value])).toEqual([["data.speed_2", "speed", 5]]);
  });

  it("ignores rows without an id (counted), skips duplicate ids, and reports unknown rows", () => {
    const source = makeSource();
    const reads = exported(source);
    const width = reads.PickList.headers.length;
    const copyOfP1 = [...reads.PickList.rows.find((r) => r[0] === P1)!];
    copyOfP1[reads.PickList.headers.indexOf("notes")] = "second copy";
    reads.PickList.rows.push(copyOfP1);
    reads.PickList.rows.push(Array(width).fill("")); // an empty line: not a row at all
    const noId = Array(width).fill("");
    noId[reads.PickList.headers.indexOf("notes")] = "a coach's own row";
    reads.PickList.rows.push(noId);
    const stranger = [...reads.PickList.rows.find((r) => r[0] === P2)!];
    stranger[0] = "f0000000-0000-4000-8000-00000000dead";
    reads.PickList.rows.push(stranger);
    const t = table(diffWorkbook(reads, source), "PickList");
    expect(t.withoutId).toBe(1);
    expect(t.duplicateIds).toEqual([P1]);
    expect(t.unmatched).toEqual([{ rowId: "f0000000-0000-4000-8000-00000000dead" }]);
    expect(t.changes).toEqual([]);
    expect(t.rowsRead).toBe(6);
  });

  it("reports rows Vantage has but the workbook does not, only within the export's scope", () => {
    const source = makeSource();
    const reads = exported(source);
    reads.PickList.rows = reads.PickList.rows.filter((r) => r[0] !== P3);
    reads.MatchScouting.rows = reads.MatchScouting.rows.filter((r) => r[0] !== M2);
    source.matchScouting.push(scout("c0000000-0000-4000-8000-000000000099", { autoPoints: 1 }, { inScope: false }));
    const preview = diffWorkbook(reads, source);
    expect(table(preview, "PickList").notInWorkbook).toEqual([{ rowId: P3, label: "Team 971" }]);
    expect(table(preview, "MatchScouting").notInWorkbook.map((r) => r.rowId)).toEqual([M2]);
    expect(preview.totals.changes).toBe(0);
  });

  it("does nothing with a missing table or one without its id / updated_at columns", () => {
    const source = makeSource();
    const reads = exported(source);
    const noUpdated: WorkbookTableRead = {
      headers: reads.PickList.headers.map((h) => (h === "updated_at" ? "last_changed" : h)),
      rows: reads.PickList.rows,
    };
    noUpdated.rows.forEach((row) => (row[noUpdated.headers.indexOf("notes")] = "changed"));
    const preview = diffWorkbook({ PickList: noUpdated, MatchScouting: null }, source);
    const pickTable = table(preview, "PickList");
    expect(pickTable.found).toBe(true);
    expect(pickTable.changes).toEqual([]);
    expect(pickTable.missingColumns).toEqual(["updated_at"]);
    expect(pickTable.notice).toMatch(/id or updated_at/);
    expect(table(preview, "MatchScouting")).toMatchObject({ found: false, changes: [] });
    expect(table(preview, "MatchScouting").notice).toMatch(/Sync now/);
    expect(table(preview, "PitScouting").found).toBe(false);
  });

  it("lists columns a coach added, without importing them", () => {
    const source = makeSource();
    const reads = exported(source);
    reads.PickList.headers.push("My comments");
    reads.PickList.rows.forEach((row) => row.push("hello"));
    reads.MatchScouting.headers.push("data.inventedField");
    reads.MatchScouting.rows.forEach((row) => row.push(1));
    const preview = diffWorkbook(reads, source);
    expect(table(preview, "PickList").unknownColumns).toEqual(["My comments"]);
    expect(table(preview, "MatchScouting").unknownColumns).toEqual(["data.inventedField"]);
    expect(preview.totals.changes).toBe(0);
  });

  it("does not apply anything to a locked pick list, and says why", () => {
    const source = makeSource({ pickList: { id: LIST, name: "Saturday list", status: "locked" } });
    const reads = exported(source);
    setCell(reads.PickList, P1, "notes", "late note");
    const t = table(diffWorkbook(reads, source), "PickList");
    expect(t.changes).toEqual([]);
    expect(t.invalid).toMatchObject([{ rowId: P1, field: "notes", reason: expect.stringMatching(/locked/) }]);
    expect(t.notice).toMatch(/locked/);
  });

  it("imports nothing but counts when no one has a pick list", () => {
    const source = makeSource({ pickList: null, pickEntries: [] });
    const reads = exported(makeSource());
    const t = table(diffWorkbook(reads, source), "PickList");
    expect(t.unmatched).toHaveLength(3);
    expect(t.changes).toEqual([]);
  });
});

describe("workbookColumnValues", () => {
  it("returns the distinct non-blank values of a named column", () => {
    const read: WorkbookTableRead = { headers: ["id", "pick_list_id"], rows: [["a", LIST], ["b", LIST], ["", ""], [" c ", null]] };
    expect(workbookColumnValues(read, "id")).toEqual(["a", "b", "c"]);
    expect(workbookColumnValues(read, "pick_list_id")).toEqual([LIST]);
    expect(workbookColumnValues(read, "nope")).toEqual([]);
    expect(workbookColumnValues(null, "id")).toEqual([]);
  });
});
