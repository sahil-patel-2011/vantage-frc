import { describe, expect, it } from "vitest";
import {
  BUDGET_CLOSE_RATIO,
  BUDGET_VS_ACTUAL_SQL,
  classifyBudgetLine,
  describeBudgetLine,
  rollupBudgetVsActual,
  type BudgetVsActualInput,
} from "./budget-vs-actual";

function line(overrides: Partial<BudgetVsActualInput> = {}): BudgetVsActualInput {
  return { categoryId: "cat-1", name: "Travel", budgetUsd: 1000, spentUsd: 0, incomeUsd: 0, ...overrides };
}

describe("classifyBudgetLine", () => {
  it("never invents a budget for a category that has none", () => {
    expect(classifyBudgetLine({ budgetUsd: null, spentUsd: 250 })).toEqual({
      state: "no_budget",
      remainingUsd: null,
      consumedRatio: null,
    });
  });

  it("marks an untouched budget as unused, not on track", () => {
    expect(classifyBudgetLine({ budgetUsd: 1000, spentUsd: 0 })).toEqual({
      state: "unused",
      remainingUsd: 1000,
      consumedRatio: 0,
    });
  });

  it("flags a line at the close threshold", () => {
    const at = classifyBudgetLine({ budgetUsd: 1000, spentUsd: 1000 * BUDGET_CLOSE_RATIO });
    expect(at.state).toBe("close");
    const under = classifyBudgetLine({ budgetUsd: 1000, spentUsd: 799 });
    expect(under.state).toBe("on_track");
  });

  it("reports an overspend with the real overage", () => {
    const over = classifyBudgetLine({ budgetUsd: 1000, spentUsd: 1240.5 });
    expect(over.state).toBe("over");
    expect(over.remainingUsd).toBe(-240.5);
    expect(over.consumedRatio).toBeCloseTo(1.2405, 4);
  });

  it("treats a deliberate zero budget as over once anything is spent, with no ratio to divide by", () => {
    expect(classifyBudgetLine({ budgetUsd: 0, spentUsd: 5 })).toEqual({
      state: "over",
      remainingUsd: -5,
      consumedRatio: null,
    });
    expect(classifyBudgetLine({ budgetUsd: 0, spentUsd: 0 }).state).toBe("unused");
  });

  it("stays cent-accurate across a long season", () => {
    const result = classifyBudgetLine({ budgetUsd: 100.1, spentUsd: 33.37 });
    expect(result.remainingUsd).toBe(66.73);
  });
});

describe("rollupBudgetVsActual", () => {
  it("puts what needs attention first: over, then close, then the rest by spend", () => {
    const { lines } = rollupBudgetVsActual([
      line({ categoryId: "a", name: "Alpha", budgetUsd: 1000, spentUsd: 100 }),
      line({ categoryId: "b", name: "Bravo", budgetUsd: 1000, spentUsd: 1200 }),
      line({ categoryId: "c", name: "Charlie", budgetUsd: 1000, spentUsd: 900 }),
      line({ categoryId: null, name: "Uncategorized", budgetUsd: null, spentUsd: 400 }),
      line({ categoryId: "d", name: "Delta", budgetUsd: 500, spentUsd: 0 }),
    ]);
    expect(lines.map((l) => l.name)).toEqual(["Bravo", "Charlie", "Alpha", "Uncategorized", "Delta"]);
  });

  it("totals budget, spend, and the uncategorized bucket separately", () => {
    const { totals } = rollupBudgetVsActual([
      line({ categoryId: "a", name: "Alpha", budgetUsd: 1000, spentUsd: 1200, incomeUsd: 50 }),
      line({ categoryId: "b", name: "Bravo", budgetUsd: 250.25, spentUsd: 100 }),
      line({ categoryId: null, name: "Uncategorized", budgetUsd: null, spentUsd: 400 }),
    ]);
    expect(totals).toEqual({
      budgetedUsd: 1250.25,
      spentUsd: 1700,
      incomeUsd: 50,
      remainingUsd: -449.75,
      overCount: 1,
      uncategorizedUsd: 400,
    });
  });

  it("never folds uncategorized spend into the budgeted categories", () => {
    const { lines, totals } = rollupBudgetVsActual([
      line({ categoryId: "a", name: "Alpha", budgetUsd: 1000, spentUsd: 100 }),
      line({ categoryId: null, name: "Uncategorized", budgetUsd: null, spentUsd: 400 }),
    ]);
    expect(lines.find((l) => l.name === "Alpha")!.spentUsd).toBe(100);
    expect(totals.uncategorizedUsd).toBe(400);
  });

  it("reports hasData false for a team that has set nothing up", () => {
    expect(rollupBudgetVsActual([]).hasData).toBe(false);
    expect(rollupBudgetVsActual([line({ budgetUsd: null, spentUsd: 0, incomeUsd: 0 })]).hasData).toBe(false);
    expect(rollupBudgetVsActual([line({ budgetUsd: null, spentUsd: 1 })]).hasData).toBe(true);
  });
});

describe("describeBudgetLine", () => {
  it("says plainly that no budget exists rather than showing 0%", () => {
    const [noBudget] = rollupBudgetVsActual([line({ budgetUsd: null, spentUsd: 250 })]).lines;
    expect(describeBudgetLine(noBudget!)).toMatch(/no budget set/i);
    expect(describeBudgetLine(noBudget!)).not.toMatch(/%/);
  });

  it("names the overage on an over-budget line", () => {
    const [over] = rollupBudgetVsActual([line({ budgetUsd: 1000, spentUsd: 1240 })]).lines;
    expect(describeBudgetLine(over!)).toMatch(/over by \$240/);
  });
});

describe("BUDGET_VS_ACTUAL_SQL", () => {
  it("is parameterized, org-scoped, and ignores non-cash BOM estimates", () => {
    expect(BUDGET_VS_ACTUAL_SQL).toContain("$1::uuid");
    expect(BUDGET_VS_ACTUAL_SQL).toContain("$2::int");
    expect(BUDGET_VS_ACTUAL_SQL).toContain("t.counts_in_balance");
    expect(BUDGET_VS_ACTUAL_SQL).not.toMatch(/\+\s*orgId/);
  });

  it("keeps uncategorized spend as its own row", () => {
    expect(BUDGET_VS_ACTUAL_SQL).toContain("'Uncategorized'");
    expect(BUDGET_VS_ACTUAL_SQL).toContain("a.category_id IS NULL");
  });
});
