import { describe, expect, it } from "vitest";
import {
  computeGrantSpendAttribution,
  EMPTY_GRANT_SPEND,
  grantLinkedTransactions,
} from "./spend-linkage";

const GRANT_A = "22222222-2222-4222-8222-222222222222";
const GRANT_B = "33333333-3333-4333-8333-333333333333";

const TAGGED_PARTS = {
  grantApplicationId: GRANT_A,
  amountUsd: 150,
  category: "Robot parts",
};
const TAGGED_TRAVEL = {
  grantApplicationId: GRANT_A,
  amountUsd: 75.555,
  category: "Travel",
};
const TAGGED_OTHER_GRANT = {
  grantApplicationId: GRANT_B,
  amountUsd: 400,
  category: "Travel",
};
const UNTAGGED_SEASON = {
  grantApplicationId: null,
  amountUsd: 5000,
  category: "Season operations",
};

describe("grantLinkedTransactions", () => {
  it("keeps only rows tagged to the requested grant", () => {
    const linked = grantLinkedTransactions(
      [TAGGED_PARTS, TAGGED_TRAVEL, TAGGED_OTHER_GRANT, UNTAGGED_SEASON],
      GRANT_A,
    );
    expect(linked).toEqual([
      { category: "Robot parts", amountUsd: 150 },
      { category: "Travel", amountUsd: 75.56 },
    ]);
  });

  it("drops untagged season expenses and other-grant tags", () => {
    expect(grantLinkedTransactions([UNTAGGED_SEASON, TAGGED_OTHER_GRANT], GRANT_A)).toEqual([]);
  });
});

describe("computeGrantSpendAttribution", () => {
  it("stays setup_required at $0 when the linkage schema is missing — even with season totals", () => {
    const spend = computeGrantSpendAttribution({
      grantApplicationId: GRANT_A,
      schemaAvailable: false,
      transactions: [TAGGED_PARTS, UNTAGGED_SEASON],
    });
    expect(spend).toEqual(EMPTY_GRANT_SPEND);
    expect(spend.totalSpendUsd).toBe(0);
    expect(spend.spendAttribution).toBe("setup_required");
    expect(spend.spendByCategory).toEqual([]);
  });

  it("attributes only tagged expenses when the schema is present", () => {
    const spend = computeGrantSpendAttribution({
      grantApplicationId: GRANT_A,
      schemaAvailable: true,
      transactions: [TAGGED_PARTS, TAGGED_TRAVEL, TAGGED_OTHER_GRANT, UNTAGGED_SEASON],
    });
    expect(spend.spendAttribution).toBe("explicit");
    expect(spend.totalSpendUsd).toBe(225.56);
    expect(spend.spendByCategory).toEqual([
      { category: "Robot parts", totalUsd: 150, count: 1 },
      { category: "Travel", totalUsd: 75.56, count: 1 },
    ]);
    expect(spend.spendByCategory.some((line) => line.category === "Season operations")).toBe(false);
    expect(spend.totalSpendUsd).toBeLessThan(5000);
  });

  it("returns explicit $0 when the schema exists but nothing is tagged to this grant", () => {
    const spend = computeGrantSpendAttribution({
      grantApplicationId: GRANT_A,
      schemaAvailable: true,
      transactions: [UNTAGGED_SEASON, TAGGED_OTHER_GRANT],
    });
    expect(spend.spendAttribution).toBe("explicit");
    expect(spend.totalSpendUsd).toBe(0);
    expect(spend.spendByCategory).toEqual([]);
  });
});
