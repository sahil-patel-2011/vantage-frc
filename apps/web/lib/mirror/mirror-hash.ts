/**
 * Proof that the Google and Excel copies hold the same data.
 *
 * Every mirror sync builds the tables once from Postgres and hashes them. The hash is
 * stored on each copy's connection when that copy is written in full, and printed in the
 * copy's SyncInfo sheet — so "both copies say the same thing" is a comparison of two short
 * strings, checkable by a person looking at the two sheets as well as by Vantage.
 *
 * SyncInfo and the Tables catalog are left out of the hash: they carry the sync time, which
 * changes on every run even when nothing else does, and only describe the other tables.
 */

import { createHash } from "node:crypto";
import type { BuiltTable, CellValue } from "../microsoft/workbook-schema";

export type MirrorCopy = "excel" | "google";
export const MIRROR_COPIES: readonly MirrorCopy[] = ["excel", "google"];

export function mirrorCopyLabel(copy: MirrorCopy): string {
  return copy === "excel" ? "Microsoft Excel" : "Google Sheets";
}

/** sha256 over every data table's name, columns and rows, in table order. */
export function contentHash(tables: BuiltTable[]): string {
  const hash = createHash("sha256");
  for (const table of tables) {
    // SyncInfo and the Tables catalog carry the sync time and are derived from the rest.
    if (table.spec.entity === "SyncInfo" || table.spec.entity === "Tables") continue;
    hash.update(JSON.stringify([table.spec.entity, table.spec.columns]));
    for (const row of table.rows) hash.update(JSON.stringify(row));
    hash.update("\u0000");
  }
  return hash.digest("hex").slice(0, 32);
}

/**
 * The same tables with two extra SyncInfo rows: the content hash and which copies this sync
 * wrote. Both copies get these identical rows, so a person can open either spreadsheet and
 * compare `content_hash` by eye.
 */
export function withMirrorInfo(tables: BuiltTable[], hash: string, copies: readonly MirrorCopy[]): BuiltTable[] {
  return tables.map((table) => {
    if (table.spec.entity !== "SyncInfo") return table;
    const template = table.rows[0] ?? [];
    const width = table.spec.columns.length;
    const row = (key: string, value: CellValue): CellValue[] => {
      const out: CellValue[] = [key, value];
      // Keep the remaining columns (updated_at, source) exactly as the other rows carry them.
      for (let i = 2; i < width; i += 1) out.push(template[i] ?? null);
      return out;
    };
    return {
      spec: table.spec,
      rows: [
        ...table.rows,
        row("content_hash", hash),
        row("mirror_copies", copies.map(mirrorCopyLabel).join(" + ")),
      ],
    };
  });
}
