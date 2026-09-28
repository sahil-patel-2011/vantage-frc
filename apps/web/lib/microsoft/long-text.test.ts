import { describe, expect, it } from "vitest";
import { MAX_CELL_TEXT, toCell, type BuiltTable } from "./workbook-schema";
import { LONG_TEXT_COLUMNS, longTextResolver, shardWorkbookCells } from "./long-text";

const table = (text: string): BuiltTable => ({ spec: { entity: "Tasks", sheet: "Tasks", table: "VantageTasks", columns: ["id", "notes"] }, rows: [["stable-task-id", toCell(text)]] });
describe("lossless workbook continuations", () => {
  it("round-trips Unicode, control characters, JSON and formula-looking long text within cell limits", () => {
    for (const text of ["=HYPERLINK(\"x\")" + "🤖".repeat(22000), JSON.stringify({ notes: "notes".repeat(18000), precision: "9007199254740993123" }), "\u0000\r\n\"\\".repeat(20000), "vantage:text:" + "a".repeat(64)]) {
      const original = table(text);
      const [data, chunks] = shardWorkbookCells([original]);
      expect(chunks!.rows.length).toBeGreaterThan(0);
      expect(data!.rows[0]![0]).toBe("stable-task-id");
      expect([data!, chunks!].flatMap((entry) => entry.rows.flat()).every((cell) => typeof cell !== "string" || cell.length <= MAX_CELL_TEXT)).toBe(true);
      const restore = longTextResolver(LONG_TEXT_COLUMNS, chunks!.rows);
      expect(restore(data!.rows[0]![1])).toBe(original.rows[0]![1]);
      expect(restore("ordinary text")).toBe("ordinary text");
    }
  });
  it("rejects missing, changed and duplicate continuation parts", () => {
    const [data, chunks] = shardWorkbookCells([table("long".repeat(20000))]);
    const reference = data!.rows[0]![1];
    expect(() => longTextResolver([], [])(reference)).toThrow(/incomplete/);
    expect(() => longTextResolver(LONG_TEXT_COLUMNS, chunks!.rows.slice(1))(reference)).toThrow(/incomplete/);
    expect(() => longTextResolver(LONG_TEXT_COLUMNS, [...chunks!.rows, chunks!.rows[0]!])(reference)).toThrow(/incomplete/);
    const edited = chunks!.rows.map((row) => [...row]); edited[0]![2] = JSON.stringify("edited");
    expect(() => longTextResolver(LONG_TEXT_COLUMNS, edited)(reference)).toThrow(/integrity/);
  });
  it("is deterministic and clears continuations when values are deleted", () => {
    const source = [table("long".repeat(12000)), table("long".repeat(12000))];
    const one = shardWorkbookCells(source);
    expect(one).toEqual(shardWorkbookCells(source));
    expect(one.at(-1)!.rows).toHaveLength(12);
    expect(shardWorkbookCells([table("")]).at(-1)!.rows).toEqual([]);
  });
});
