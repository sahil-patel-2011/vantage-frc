import { describe, expect, it } from "vitest";
import { plainStrategyText } from "./plain-text";

describe("scout weighting in plain words", () => {
  it("drops the user id and the model's maths", () => {
    const out = plainStrategyText(
      "Scout quality mean weight 49% — Scout 6925a000 downweighted to 45%: Scoring mean 51.3 vs consensus 5 (Δ 46.3); weight 0.45.",
    );
    expect(out).toBe("One scout's numbers were far from the others', so they count for less.");
    expect(out).not.toMatch(/6925a000|consensus|Δ|weight 0/);
  });
});
