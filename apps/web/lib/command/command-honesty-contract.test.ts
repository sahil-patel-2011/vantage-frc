import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "load-command.ts"), "utf8");

describe("Command prediction honesty", () => {
  it("finalizes Strategy the same way /api/strategy GET does", () => {
    expect(source).toContain("finalizeStrategyRecompute");
    expect(source).toContain("await computeStrategyView(");
    expect(source).not.toMatch(/pRed \* 100/);
  });
});
