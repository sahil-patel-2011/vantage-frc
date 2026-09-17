import { describe, expect, it } from "vitest";
import { numericOrNull } from "./numeric-or-null";

/**
 * The dashboard told a drive team "0% chance we win" for a match nobody had
 * predicted yet, because the widget coerced a null probability with Number().
 * These pin the distinction that bug erased: absent is not zero.
 */
describe("numericOrNull", () => {
  it("keeps a real zero, which is a different thing from nothing", () => {
    // A genuine 0% and an unknown chance must never render the same way.
    expect(numericOrNull(0)).toBe(0);
    expect(numericOrNull("0")).toBe(0);
  });

  it("returns null for the values Number() would turn into zero", () => {
    expect(numericOrNull(null)).toBeNull();
    expect(numericOrNull(undefined)).toBeNull();
    expect(numericOrNull("")).toBeNull();
    // The whole reason this function exists.
    expect(Number(null)).toBe(0);
    expect(Number("")).toBe(0);
  });

  it("reads a number out of a string, as a JSON payload delivers it", () => {
    expect(numericOrNull("0.62")).toBeCloseTo(0.62, 5);
    expect(numericOrNull("-3")).toBe(-3);
  });

  it("refuses anything that is not a finite number", () => {
    expect(numericOrNull("sixty percent")).toBeNull();
    expect(numericOrNull(Number.NaN)).toBeNull();
    expect(numericOrNull(Number.POSITIVE_INFINITY)).toBeNull();
    expect(numericOrNull({})).toBeNull();
    expect(numericOrNull([])).toBeNull();
    expect(numericOrNull(true)).toBeNull();
  });

  it("does not treat whitespace as zero", () => {
    // Number("  ") is 0 too.
    expect(numericOrNull("   ")).toBeNull();
  });
});
