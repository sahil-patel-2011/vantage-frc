import { describe, expect, it } from "vitest";
import type { ImportChange, ImportPreview, WorkbookTableRead } from "../microsoft/workbook-import";
import type { CellValue } from "../microsoft/workbook-schema";
import { importReadPlan, mergeCopyReads } from "./mirror-merge";

const HEADERS = ["id", "team", "rank", "notes"];

function read(rows: unknown[][], headers = HEADERS): WorkbookTableRead {
  return { headers, rows };
}

function change(rowId: string, field: string, from: CellValue, to: CellValue): ImportChange {
  return { id: `${rowId}-${field}-${String(to)}`, entity: "PickList", rowId, label: rowId, field, from, to, value: to, version: "v1" };
}

function preview(changes: ImportChange[]): ImportPreview {
  return {
    tables: [
      {
        entity: "PickList",
        found: true,
        rowsRead: 0,
        changes,
        conflicts: [],
        readOnlyEdits: [],
        invalid: [],
        unmatched: [],
        notInWorkbook: [],
        withoutId: 0,
        duplicateIds: [],
        unknownColumns: [],
        missingColumns: [],
        notice: null,
      },
    ],
    totals: { changes: changes.length, conflicts: 0, readOnlyEdits: 0, invalid: 0, unmatched: 0, notInWorkbook: 0, withoutId: 0, duplicateIds: 0 },
  };
}

const exported = [
  ["a", "frc254", 1, ""],
  ["b", "frc1678", 2, ""],
];

describe("mergeCopyReads", () => {
  it("takes an edit made only in the second copy", () => {
    const merged = mergeCopyReads([
      { copy: "excel", reads: { PickList: read(exported) }, preview: preview([]) },
      {
        copy: "google",
        reads: { PickList: read([["a", "frc254", 1, "great climber"], exported[1]!]) },
        preview: preview([change("a", "notes", "", "great climber")]),
      },
    ]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.reads.PickList!.rows[0]).toEqual(["a", "frc254", 1, "great climber"]);
    expect(merged.editSources).toEqual([{ entity: "PickList", rowId: "a", field: "notes", copy: "google" }]);
  });

  it("keeps edits from both copies when they touch different fields", () => {
    const merged = mergeCopyReads([
      {
        copy: "excel",
        reads: { PickList: read([["a", "frc254", 3, ""], exported[1]!]) },
        preview: preview([change("a", "rank", 1, 3)]),
      },
      {
        copy: "google",
        reads: { PickList: read([exported[0]!, ["b", "frc1678", 2, "slow cycles"]]) },
        preview: preview([change("b", "notes", "", "slow cycles")]),
      },
    ]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.reads.PickList!.rows).toEqual([
      ["a", "frc254", 3, ""],
      ["b", "frc1678", 2, "slow cycles"],
    ]);
  });

  it("treats the same edit in both copies as one edit", () => {
    const edited = [["a", "frc254", 5, ""], exported[1]!];
    const merged = mergeCopyReads([
      { copy: "excel", reads: { PickList: read(edited) }, preview: preview([change("a", "rank", 1, 5)]) },
      { copy: "google", reads: { PickList: read(edited) }, preview: preview([change("a", "rank", 1, 5)]) },
    ]);
    expect(merged.conflicts).toEqual([]);
    expect(merged.reads.PickList!.rows[0]).toEqual(["a", "frc254", 5, ""]);
  });

  it("refuses to pick a winner when the two copies disagree, and shows both", () => {
    const merged = mergeCopyReads([
      { copy: "excel", reads: { PickList: read([["a", "frc254", 4, ""], exported[1]!]) }, preview: preview([change("a", "rank", 1, 4)]) },
      { copy: "google", reads: { PickList: read([["a", "frc254", 7, ""], exported[1]!]) }, preview: preview([change("a", "rank", 1, 7)]) },
    ]);
    // The exported value goes back in, so the import applies neither edit.
    expect(merged.reads.PickList!.rows[0]).toEqual(["a", "frc254", 1, ""]);
    expect(merged.conflicts).toEqual([
      {
        entity: "PickList",
        rowId: "a",
        label: "a",
        field: "rank",
        values: [
          { copy: "excel", value: 4 },
          { copy: "google", value: 7 },
        ],
      },
    ]);
  });

  it("follows columns by name when a coach reordered them in one copy", () => {
    const reordered = ["notes", "id", "rank", "team"];
    const merged = mergeCopyReads([
      { copy: "excel", reads: { PickList: read(exported) }, preview: preview([]) },
      {
        copy: "google",
        reads: { PickList: read([["watch auto", "b", 2, "frc1678"], ["", "a", 1, "frc254"]], reordered) },
        preview: preview([change("b", "notes", "", "watch auto")]),
      },
    ]);
    expect(merged.reads.PickList!.rows[1]).toEqual(["b", "frc1678", 2, "watch auto"]);
  });

  it("does not call a row missing when only one copy deleted it", () => {
    const merged = mergeCopyReads([
      { copy: "excel", reads: { PickList: read([exported[0]!]) }, preview: preview([]) },
      { copy: "google", reads: { PickList: read(exported) }, preview: preview([]) },
    ]);
    expect(merged.reads.PickList!.rows.map((row) => row[0])).toEqual(["a", "b"]);
  });

  it("works from a single copy when that is all that could be read", () => {
    const merged = mergeCopyReads([{ copy: "google", reads: { PickList: read(exported) }, preview: preview([]) }]);
    expect(merged.reads.PickList!.rows).toEqual(exported);
  });
});

describe("importReadPlan", () => {
  const now = new Date("2026-09-23T12:00:00Z");
  const base = { connected: true, throttledUntil: null, lastReadAt: null, lastError: null };

  it("reads both copies, least recently read first, so pulls alternate", () => {
    const plan = importReadPlan(
      [
        { copy: "excel", ...base, lastReadAt: "2026-09-23T11:00:00Z" },
        { copy: "google", ...base, lastReadAt: "2026-09-23T09:00:00Z" },
      ],
      now,
    );
    expect(plan.read).toEqual(["google", "excel"]);
    expect(plan.skipped).toEqual([]);
  });

  it("skips a resting copy and a signed-out copy, and says why", () => {
    const plan = importReadPlan(
      [
        { copy: "excel", ...base, throttledUntil: "2026-09-23T12:10:00Z" },
        { copy: "google", ...base, lastError: "Google sign-in expired or was revoked. An owner or admin needs to reconnect Google Sheets." },
      ],
      now,
    );
    expect(plan.read).toEqual([]);
    expect(plan.skipped.map((entry) => entry.copy)).toEqual(["excel", "google"]);
  });

  it("ignores copies that are not connected", () => {
    const plan = importReadPlan([{ copy: "excel", ...base, connected: false }, { copy: "google", ...base }], now);
    expect(plan.read).toEqual(["google"]);
  });
});
