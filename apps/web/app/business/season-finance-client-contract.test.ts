import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "season-finance-client.tsx"), "utf8");

describe("Season Finance honesty", () => {
  it("shows per-sponsor amounts and budget-vs-actual, never DEMO dollars", () => {
    expect(source).toContain("/api/sponsors/contributions");
    expect(source).toContain("/api/finance/budget-vs-actual");
    expect(source).toContain("describeBudgetLine");
    expect(source).toContain("Per-sponsor recorded contributions");
    expect(source).toContain("never invent DEMO dollars");
  });
});
