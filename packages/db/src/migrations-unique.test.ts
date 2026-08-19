import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../migrations");

/** Historical collisions from parallel agents. Frozen — do not add to this set. */
const KNOWN_DUPLICATE_PREFIXES = new Set([
  "0050",
  "0067",
  "0070",
  "0096",
  "0105",
  "0106",
  "0109",
  "0111",
  "0127",
  "0150",
  "0153",
  "0155",
  "0162",
  "0163",
  "0166",
  "0171",
  "0172",
  "0177",
  "0184",
  "0219",
  "0258",
  "0259",
  "0264",
  "0265",
]);

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{4}_.+\.sql$/.test(name));
}

describe("migration numbering", () => {
  it("does not introduce new duplicate prefixes after the frozen historical set", () => {
    const byPrefix = new Map<string, string[]>();
    for (const name of listMigrationFiles()) {
      const prefix = name.slice(0, 4);
      const list = byPrefix.get(prefix) ?? [];
      list.push(name);
      byPrefix.set(prefix, list);
    }
    const unexpected: string[] = [];
    for (const [prefix, files] of byPrefix) {
      if (files.length > 1 && !KNOWN_DUPLICATE_PREFIXES.has(prefix)) {
        unexpected.push(`${prefix}: ${files.join(", ")}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it("keeps the next free number at or above 0438", () => {
    const prefixes = listMigrationFiles().map((name) => Number(name.slice(0, 4)));
    expect(Math.max(...prefixes)).toBeGreaterThanOrEqual(438);
    expect(listMigrationFiles().some((name) => name.startsWith("0438_"))).toBe(true);
  });
});
