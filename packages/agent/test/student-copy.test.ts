import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "tools.ts");

/**
 * Ask AI tool descriptions and trust notes can be echoed into student chat.
 * Identifiers like scoutTbaConflicts / epaMovers stay. Do not invent a
 * last-snapshot. Connect TBA stays off this family.
 */
const LEFTOVER = [
  /\bpEPA\b/,
  /EPA movers/,
  /vs TBA/,
  /Statbotics clones/,
  /scouting\/EPA/,
  /TBA official/,
  /TBA-contradicted/,
  /TBA trust/,
  /TBA scout conflicts/,
  /TBA contradiction/,
  /FIRST, TBA, Statbotics/,
];

describe("Ask AI tool student-facing copy", () => {
  it("does not print leftover EPA / TBA phrases in tool descriptions", () => {
    const src = readFileSync(SRC, "utf8");
    for (const pattern of LEFTOVER) {
      expect(src, String(pattern)).not.toMatch(pattern);
    }
    expect(src).toMatch(/season ratings/);
    expect(src).toMatch(/official match results/);
    expect(src).toMatch(/season-score movers/);
  });
});
