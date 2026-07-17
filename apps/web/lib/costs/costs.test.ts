import { describe, expect, it } from "vitest";
import { budgetInsights, costCategoryLabel, summarizeCosts, usd } from "./costs";
import type { SeasonBudget, SeasonCost } from "./types";

let seq = 0;
function cost(overrides: Partial<SeasonCost> = {}): SeasonCost {
  seq += 1;
  return {
    id: `c-${seq}`,
    label: `Cost ${seq}`,
    category: "parts",
    amountUsd: 100,
    vendor: null,
    incurredOn: "2026-02-10",
    status: "paid",
    notes: null,
    ...overrides,
  };
}

function budget(overrides: Partial<SeasonBudget> = {}): SeasonBudget {
  return { seasonYear: 2026, totalBudgetUsd: 10000, aiAssistEnabled: true, notes: null, ...overrides };
}

describe("summarizeCosts", () => {
  it("is all-zero for no costs and no budget", () => {
    const s = summarizeCosts([], null);
    expect(s.count).toBe(0);
    expect(s.totalCommitted).toBe(0);
    expect(s.remaining).toBeNull();
    expect(s.pctUsed).toBeNull();
    expect(s.overBudget).toBe(false);
  });

  it("splits paid vs planned and computes committed total", () => {
    const s = summarizeCosts(
      [cost({ amountUsd: 200, status: "paid" }), cost({ amountUsd: 50, status: "planned" })],
      10000,
    );
    expect(s.totalPaid).toBe(200);
    expect(s.totalPlanned).toBe(50);
    expect(s.totalCommitted).toBe(250);
    expect(s.remaining).toBe(9750);
    expect(s.pctUsed).toBe(0.025);
  });

  it("sums the big fixed fees (registration + event fees)", () => {
    const s = summarizeCosts(
      [
        cost({ category: "registration", amountUsd: 6000 }),
        cost({ category: "event_fee", amountUsd: 5000 }),
        cost({ category: "parts", amountUsd: 300 }),
      ],
      20000,
    );
    expect(s.feesTotal).toBe(11000);
  });

  it("avoids float drift on cent math", () => {
    const s = summarizeCosts([cost({ amountUsd: 0.1 }), cost({ amountUsd: 0.2 })], null);
    expect(s.totalCommitted).toBe(0.3); // not 0.30000000000000004
  });

  it("breaks down by category sorted by committed, and by month", () => {
    const s = summarizeCosts(
      [
        cost({ category: "parts", amountUsd: 100, incurredOn: "2026-01-05" }),
        cost({ category: "travel", amountUsd: 900, incurredOn: "2026-02-05" }),
        cost({ category: "parts", amountUsd: 50, incurredOn: "2026-02-15" }),
      ],
      5000,
    );
    expect(s.byCategory[0]?.category).toBe("travel"); // 900 highest
    expect(s.byCategory.find((c) => c.category === "parts")?.committed).toBe(150);
    expect(s.largestCategory?.category).toBe("travel");
    expect(s.byMonth.map((m) => m.month)).toEqual(["2026-01", "2026-02"]);
  });

  it("flags over budget", () => {
    const s = summarizeCosts([cost({ amountUsd: 12000 })], 10000);
    expect(s.overBudget).toBe(true);
    expect(s.remaining).toBe(-2000);
    expect(s.pctUsed).toBe(1.2);
  });
});

describe("budgetInsights", () => {
  it("asks for a budget when none is set", () => {
    const summary = summarizeCosts([cost()], null);
    const insight = budgetInsights(summary, budget({ totalBudgetUsd: null }));
    expect(insight.status).toBe("unset");
    expect(insight.recommendations.join(" ")).toMatch(/budget/i);
  });

  it("reports healthy with margin", () => {
    const costs = [cost({ category: "registration", amountUsd: 6000 }), cost({ category: "event_fee", amountUsd: 1000 })];
    const summary = summarizeCosts(costs, 20000);
    const insight = budgetInsights(summary, budget({ totalBudgetUsd: 20000 }));
    expect(insight.status).toBe("healthy");
    expect(insight.headline).toMatch(/on track/i);
  });

  it("warns at the 85% watch threshold", () => {
    const summary = summarizeCosts([cost({ category: "registration", amountUsd: 8600 }), cost({ category: "event_fee", amountUsd: 200 })], 10000);
    const insight = budgetInsights(summary, budget({ totalBudgetUsd: 10000 }));
    expect(insight.status).toBe("watch");
    expect(insight.recommendations.join(" ")).toMatch(/remain/i);
  });

  it("flags overspend with the largest category to cut", () => {
    const summary = summarizeCosts(
      [cost({ category: "travel", amountUsd: 9000 }), cost({ category: "registration", amountUsd: 6000 })],
      10000,
    );
    const insight = budgetInsights(summary, budget({ totalBudgetUsd: 10000 }));
    expect(insight.status).toBe("over");
    expect(insight.headline).toMatch(/over budget/i);
    expect(insight.recommendations[0]).toMatch(/Travel|trim|defer/i);
  });

  it("warns when planned costs exceed the remaining budget", () => {
    const summary = summarizeCosts(
      [
        cost({ category: "registration", amountUsd: 6000, status: "paid" }),
        cost({ category: "travel", amountUsd: 5000, status: "planned" }),
      ],
      10000,
    );
    const insight = budgetInsights(summary, budget({ totalBudgetUsd: 10000 }));
    expect(insight.recommendations.join(" ")).toMatch(/planned/i);
  });

  it("nudges to log registration when it is missing", () => {
    const summary = summarizeCosts([cost({ category: "parts", amountUsd: 100 })], 10000);
    const insight = budgetInsights(summary, budget({ totalBudgetUsd: 10000 }));
    expect(insight.recommendations.join(" ")).toMatch(/registration/i);
  });
});

describe("helpers", () => {
  it("labels categories and formats usd", () => {
    expect(costCategoryLabel("event_fee")).toBe("Event fees");
    expect(usd(1234.5)).toBe("$1,234.5");
  });
});
