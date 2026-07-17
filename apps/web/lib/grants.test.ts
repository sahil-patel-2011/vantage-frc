import { describe, expect, it } from "vitest";
import { grantStatusLabel, summarizeGrantHistory, validateGrantOpportunityInput } from "./grants";

describe("grant opportunity validation", () => {
  it("requires a name", () => {
    expect(validateGrantOpportunityInput({}).ok).toBe(false);
  });

  it("rejects an inverted amount range", () => {
    const result = validateGrantOpportunityInput({ name: "NASA Grant", amountMinUsd: 5000, amountMaxUsd: 1000 });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid opportunity", () => {
    const result = validateGrantOpportunityInput({ name: "NASA Grant", amountMinUsd: 1000, amountMaxUsd: 5000 });
    expect(result.ok).toBe(true);
  });
});

describe("grant status labels", () => {
  it("maps every status to a readable label", () => {
    expect(grantStatusLabel("in_review")).toBe("In review");
  });
});

describe("grant history summary", () => {
  it("totals awarded amounts across applications", () => {
    const summary = summarizeGrantHistory([
      { status: "awarded", amountAwardedUsd: 2000 },
      { status: "declined", amountAwardedUsd: null },
      { status: "awarded", amountAwardedUsd: 500 },
    ]);
    expect(summary.totalAwarded).toBe(2);
    expect(summary.totalAwardedUsd).toBe(2500);
  });
});
