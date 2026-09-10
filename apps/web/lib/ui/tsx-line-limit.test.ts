import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");
const LIMIT = 1000;

function collectTsx(dir: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) collectTsx(full, acc);
    else if (entry.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

describe("tsx line limit", () => {
  it(`keeps every apps/web TSX file at or under ${LIMIT} lines`, () => {
    const over = collectTsx(WEB_ROOT)
      .map((file) => {
        const lines = readFileSync(file, "utf8").split("\n").length;
        return { file: relative(WEB_ROOT, file), lines };
      })
      .filter((row) => row.lines > LIMIT)
      .sort((a, b) => b.lines - a.lines);
    expect(over, over.map((row) => `${row.file}:${row.lines}`).join("\n")).toEqual([]);
  });
});
