import { describe, expect, it } from "vitest";
import { ourSideRange } from "./our-side-range";

describe("our side of a prediction's range", () => {
  it("flips red's interval for a blue team so it brackets our win %", () => {
    const range = ourSideRange(0.14, 0.32, "blue");
    expect(range!.low).toBeCloseTo(0.68);
    expect(range!.high).toBeCloseTo(0.86);
  });

  it("keeps red's interval for a red team, and shows none when the side is unknown", () => {
    expect(ourSideRange(0.55, 0.7, "red")).toEqual({ low: 0.55, high: 0.7 });
    expect(ourSideRange(0.55, 0.7, null)).toBeNull();
    expect(ourSideRange(null, 0.7, "red")).toBeNull();
  });
});
