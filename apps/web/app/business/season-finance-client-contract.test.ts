import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The per-sponsor and budget-vs-actual reads live in season-finance-reads.ts so they can start
// alongside the season view.
const source = ["season-finance-client.tsx", "season-finance-reads.ts"]
  .map((name) => readFileSync(join(__dirname, name), "utf8"))
  .join("\n");

describe("Season Finance honesty", () => {
  it("shows per-sponsor amounts and budget-vs-actual, never DEMO dollars", () => {
    expect(source).toContain("/api/sponsors/contributions");
    expect(source).toContain("/api/finance/budget-vs-actual");
    expect(source).toContain("describeBudgetLine");
    expect(source).toContain("Per-sponsor recorded contributions");
    expect(source).not.toMatch(/never (a )?DEMO|never invents?\b/i);
  });
});
