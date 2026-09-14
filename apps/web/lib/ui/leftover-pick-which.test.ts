import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const WEB = join(__dirname, "..", "..");

/**
 * Leftover student "Pick which FRC team you are working as." after leftover
 * pick-before / leftover-knowledge-gap. Labels already say Choose your team.
 * "Pick a teammate" stays. Do not invent a last-snapshot.
 */
function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collect(full));
      continue;
    }
    if (!name.endsWith(".tsx") && !name.endsWith(".ts")) continue;
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) continue;
    out.push(full);
  }
  return out;
}

describe("leftover student Pick which FRC team chrome", () => {
  it("does not tell the reader to Pick which FRC team", () => {
    const files = [...collect(join(WEB, "app")), ...collect(join(WEB, "lib"))];
    const leftover = files.flatMap((file) => {
      const rel = relative(WEB, file).replace(/\\/g, "/");
      const src = readFileSync(file, "utf8");
      if (!src.includes("Pick which FRC team")) return [];
      return [rel];
    });
    expect(leftover, leftover.join("\n")).toEqual([]);
  });
});
