/**
 * Pulling from both copies without losing an edit — the pure half.
 *
 * A coach may edit the pick list in Google Sheets while a mentor fixes a scouting note in
 * Excel. Reading only one copy would silently drop the other person's edit, so an import
 * reads every copy that is up and merges them field by field:
 *
 *   - an edit that only one copy has is taken from that copy;
 *   - the same edit in both copies is one edit;
 *   - different edits to the same field in the two copies are a MIRROR CONFLICT: neither
 *     is applied, and both values are shown, because Vantage cannot know which person is
 *     right. (Edits Vantage itself made since the export are still caught by the import's
 *     own optimistic-concurrency check.)
 *
 * Input is each copy's raw reads plus the import preview already computed for it (which
 * says, per field, what that copy changed relative to what Vantage exported). Output is one
 * merged set of reads that the ordinary import pipeline previews and applies unchanged.
 */

import type { ImportChange, ImportEntity, ImportPreview, WorkbookTableRead } from "../microsoft/workbook-import";
import { IMPORT_TABLES } from "../microsoft/workbook-import";
import type { CellValue } from "../microsoft/workbook-schema";
import type { Reads } from "../microsoft/run-import";
import type { MirrorCopy } from "./mirror-hash";

export type CopyRead = { copy: MirrorCopy; reads: Reads; preview: ImportPreview };

export type MirrorConflict = {
  entity: ImportEntity;
  rowId: string;
  label: string;
  field: string;
  values: Array<{ copy: MirrorCopy; value: CellValue }>;
};

export type MergeResult = {
  reads: Reads;
  conflicts: MirrorConflict[];
  /** Which copy each merged-in edit came from, for the preview ("from Google Sheets"). */
  editSources: Array<{ entity: ImportEntity; rowId: string; field: string; copy: MirrorCopy }>;
};

const key = (entity: string, rowId: string, field: string) => `${entity}\u0000${rowId}\u0000${field}`;

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function headerIndex(read: WorkbookTableRead): Map<string, number> {
  const map = new Map<string, number>();
  read.headers.forEach((header, i) => {
    const name = String(header ?? "").trim();
    if (name && !map.has(name)) map.set(name, i);
  });
  return map;
}

function cloneRead(read: WorkbookTableRead): WorkbookTableRead {
  return { headers: [...read.headers], rows: read.rows.map((row) => [...row]), truncated: read.truncated };
}

function changesFor(preview: ImportPreview, entity: ImportEntity): ImportChange[] {
  return preview.tables.find((table) => table.entity === entity)?.changes ?? [];
}

export function mergeCopyReads(copies: CopyRead[]): MergeResult {
  const conflicts: MirrorConflict[] = [];
  const editSources: MergeResult["editSources"] = [];
  const reads: Reads = {};
  if (copies.length === 0) return { reads, conflicts, editSources };

  for (const ref of IMPORT_TABLES) {
    const entity = ref.entity;
    const present = copies.filter((copy) => copy.reads[entity]);
    if (present.length === 0) {
      reads[entity] = copies[0]!.reads[entity] ?? null;
      continue;
    }
    const base = present[0]!;
    const merged = cloneRead(base.reads[entity]!);
    const baseCols = headerIndex(merged);
    const idCol = baseCols.get("id");

    // Every copy's edits, keyed by (row, field).
    const edits = new Map<string, Array<{ copy: CopyRead; change: ImportChange }>>();
    for (const copy of present) {
      for (const change of changesFor(copy.preview, entity)) {
        const k = key(entity, change.rowId, change.field);
        const list = edits.get(k) ?? [];
        list.push({ copy, change });
        edits.set(k, list);
      }
    }

    const rowById = new Map<string, unknown[]>();
    if (idCol !== undefined) {
      for (const row of merged.rows) {
        const id = String(row[idCol] ?? "").trim();
        if (id && !rowById.has(id)) rowById.set(id, row);
      }
      // A row deleted in one copy but still in another is not "missing from the workbook":
      // union the rows, so only a row gone from every copy is reported that way.
      for (const copy of present.slice(1)) {
        const other = copy.reads[entity]!;
        const otherCols = headerIndex(other);
        const otherId = otherCols.get("id");
        if (otherId === undefined) continue;
        for (const source of other.rows) {
          const id = String(source[otherId] ?? "").trim();
          if (!id || rowById.has(id)) continue;
          const row = merged.headers.map((header) => {
            const at = otherCols.get(String(header ?? "").trim());
            return at === undefined ? "" : source[at];
          });
          merged.rows.push(row);
          rowById.set(id, row);
        }
      }
    }

    for (const list of edits.values()) {
      const first = list[0]!.change;
      const distinct = list.filter((entry, i) => list.findIndex((other) => sameValue(other.change.value, entry.change.value)) === i);
      const col = baseCols.get(first.field);
      if (col === undefined || idCol === undefined) continue;

      let row = rowById.get(first.rowId);
      if (!row) {
        // The row is gone from the base copy but another copy edited it: bring that row over.
        const donor = list[0]!.copy.reads[entity]!;
        const donorCols = headerIndex(donor);
        const donorId = donorCols.get("id");
        const source = donor.rows.find((candidate) => String(candidate[donorId ?? -1] ?? "").trim() === first.rowId);
        if (!source) continue;
        row = merged.headers.map((header) => {
          const at = donorCols.get(String(header ?? "").trim());
          return at === undefined ? "" : source[at];
        });
        merged.rows.push(row);
        rowById.set(first.rowId, row);
      }

      if (distinct.length > 1) {
        // Two people disagree. Put the exported value back so neither edit applies.
        row[col] = first.from ?? "";
        conflicts.push({
          entity,
          rowId: first.rowId,
          label: first.label,
          field: first.field,
          values: list.map((entry) => ({ copy: entry.copy.copy, value: entry.change.to })),
        });
        continue;
      }

      const winner = list[0]!;
      if (winner.copy !== base) {
        const donor = winner.copy.reads[entity]!;
        const donorCols = headerIndex(donor);
        const donorId = donorCols.get("id");
        const donorCol = donorCols.get(first.field);
        const source = donor.rows.find((candidate) => String(candidate[donorId ?? -1] ?? "").trim() === first.rowId);
        if (source && donorCol !== undefined) row[col] = source[donorCol];
      }
      editSources.push({ entity, rowId: first.rowId, field: first.field, copy: winner.copy.copy });
    }

    reads[entity] = merged;
  }
  return { reads, conflicts, editSources };
}

/**
 * Which copies an import should read, least recently read first, so pulls alternate and
 * neither provider's quota carries every read. A copy that is resting after a throttle, or
 * whose sign-in is known to be gone, is skipped with a reason.
 */
export function importReadPlan(
  states: Array<{ copy: MirrorCopy; connected: boolean; throttledUntil: string | null; lastReadAt: string | null; lastError: string | null }>,
  now: Date,
): { read: MirrorCopy[]; skipped: Array<{ copy: MirrorCopy; reason: string }> } {
  const skipped: Array<{ copy: MirrorCopy; reason: string }> = [];
  const usable: typeof states = [];
  for (const state of states) {
    if (!state.connected) continue;
    const until = state.throttledUntil ? Date.parse(state.throttledUntil) : Number.NaN;
    if (Number.isFinite(until) && until > now.getTime()) {
      skipped.push({ copy: state.copy, reason: "resting after the provider asked Vantage to slow down" });
      continue;
    }
    if (state.lastError && /sign-in expired|reconnect/i.test(state.lastError)) {
      skipped.push({ copy: state.copy, reason: "its sign-in needs reconnecting" });
      continue;
    }
    usable.push(state);
  }
  usable.sort((a, b) => (a.lastReadAt ? Date.parse(a.lastReadAt) : 0) - (b.lastReadAt ? Date.parse(b.lastReadAt) : 0));
  return { read: usable.map((state) => state.copy), skipped };
}
