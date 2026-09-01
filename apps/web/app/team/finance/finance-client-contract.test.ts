import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "finance-client.tsx"), "utf8");

describe("Team Finance honesty", () => {
  it("shows recorded sponsor contributions and buy-sheet why, not a hardcoded $0 sponsor tile", () => {
    expect(source).toContain("teamContributionTotalUsd");
    expect(source).toContain("/api/sponsors/contributions");
    expect(source).toContain("Recorded sponsor contributions");
    expect(source).not.toContain("sponsorCashUsd");
    expect(source).toContain("describeBudgetLine");
    expect(source).toContain("/api/finance/budget-vs-actual");
    expect(source).toContain("why: ${r.justification}");
    expect(source).toContain("PER-SPONSOR RECORDED CONTRIBUTIONS");
    expect(source).toContain("sponsorPageTotals");
  });
});
