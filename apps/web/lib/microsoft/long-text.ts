import { createHash } from "node:crypto";
import { MAX_CELL_TEXT, type BuiltTable, type CellValue } from "./workbook-schema";

const PREFIX = "vantage:text:";
export const LONG_TEXT_SHEET = "LongText";
export const LONG_TEXT_COLUMNS = ["id", "part", "text_json", "characters"];
const PART_CHARACTERS = 4000; // Even JSON-escaped control characters fit in one Excel cell.
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Always clear the continuation table, including when deleted values leave it empty. */
export function shardWorkbookCells(tables: readonly BuiltTable[]): BuiltTable[] {
  const values = new Map<string, string>();
  const data = tables.filter((table) => table.spec.entity !== "LongText").map((table) => ({
    spec: table.spec,
    rows: table.rows.map((row) => row.map((cell): CellValue => {
      if (typeof cell !== "string" || (cell.length <= MAX_CELL_TEXT && !cell.startsWith(PREFIX))) return cell;
      const id = digest(cell);
      values.set(id, cell);
      return PREFIX + id;
    })),
  }));
  const rows: CellValue[][] = [];
  for (const [id, value] of [...values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    for (let offset = 0; offset < value.length; offset += PART_CHARACTERS) rows.push([id, offset / PART_CHARACTERS, JSON.stringify(value.slice(offset, offset + PART_CHARACTERS)), value.length]);
  }
  return [...data, { spec: { entity: "LongText", sheet: LONG_TEXT_SHEET, table: "VantageLongText", columns: LONG_TEXT_COLUMNS }, rows }];
}

/** Reject missing, reordered, edited or truncated continuations instead of importing fragments. */
export function longTextResolver(headers: readonly unknown[], rows: readonly unknown[][]): (cell: unknown) => unknown {
  const indexes = LONG_TEXT_COLUMNS.map((name) => headers.indexOf(name));
  const groups = new Map<string, Array<{ part: number; text: string; characters: number }>>();
  if (rows.length && indexes.some((index) => index < 0)) throw new Error("The LongText table is missing required columns.");
  for (const row of rows) {
    if (row.every((cell) => cell === "" || cell == null)) continue;
    const [idIndex, partIndex, textIndex, lengthIndex] = indexes as [number, number, number, number];
    const id = row[idIndex], part = Number(row[partIndex]), characters = Number(row[lengthIndex]);
    let text: unknown;
    try { text = JSON.parse(String(row[textIndex])); } catch { throw new Error("A LongText continuation is invalid."); }
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id) || !Number.isSafeInteger(part) || part < 0 || typeof text !== "string" || !Number.isSafeInteger(characters) || characters < 0) throw new Error("A LongText continuation is invalid.");
    const parts = groups.get(id) ?? [];
    parts.push({ part, text, characters }); groups.set(id, parts);
  }
  const restored = new Map<string, string>();
  return (cell) => {
    if (typeof cell !== "string" || !cell.startsWith(PREFIX)) return cell;
    const id = cell.slice(PREFIX.length);
    const cached = restored.get(id);
    if (cached !== undefined) return cached;
    const parts = groups.get(id)?.sort((a, b) => a.part - b.part);
    if (!parts?.length || parts.some((part, index) => part.part !== index || part.characters !== parts[0]!.characters)) throw new Error("Long text is incomplete. Sync the workbook again before importing.");
    const value = parts.map((part) => part.text).join("");
    if (value.length !== parts[0]!.characters || digest(value) !== id) throw new Error("Long text failed its integrity check. Edit this value in Vantage.");
    restored.set(id, value);
    return value;
  };
}
