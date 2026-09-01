import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("GET /api/strategy honesty", () => {
  it("finalizes empty-EPA coin-flips on normal load, not only ?refresh=1", () => {
    expect(source).toContain("finalizeStrategyRecompute");
    expect(source).toContain("const view = input.refresh ? strategy : finalizeStrategyRecompute(strategy)");
    expect(source).toContain("recomputeStrategyView");
  });
});
