import { describe, expect, it } from "vitest";
import { ratingSplit, ratingValue, splitWidths } from "./rating-split";

describe("ratingSplit", () => {
  it("turns three numbers into shares of one bar", () => {
    const split = ratingSplit({ auto: 8.5, teleop: 31.8, endgame: 14.6 })!;
    expect(split.total).toBeCloseTo(54.9, 5);
    expect(split.parts.map((part) => part.id)).toEqual(["auto", "teleop", "endgame"]);
    expect(split.parts[1]?.share).toBeCloseTo(31.8 / 54.9, 5);
    // The shares are a whole, not three unrelated fractions.
    expect(split.parts.reduce((sum, part) => sum + part.share, 0)).toBeCloseTo(1, 10);
  });

  it("reports the total as the sum, so the bar and the number agree", () => {
    const split = ratingSplit({ auto: 1, teleop: 2, endgame: 3 })!;
    expect(split.total).toBe(6);
  });

  it("keeps a real zero part but refuses a bar that is all zero", () => {
    const withZero = ratingSplit({ auto: 0, teleop: 10, endgame: 5 })!;
    expect(withZero.parts[0]?.value).toBe(0);
    expect(withZero.parts[0]?.share).toBe(0);
    // All-zero is "measured and it is nothing", which is a different claim from
    // "not measured yet" — the caller must show its empty state instead.
    expect(ratingSplit({ auto: 0, teleop: 0, endgame: 0 })).toBeNull();
  });

  it("refuses to draw when any part is missing or not a number", () => {
    expect(ratingSplit({ auto: 8.5, teleop: 31.8 })).toBeNull();
    expect(ratingSplit({ auto: 8.5, teleop: null, endgame: 3 })).toBeNull();
    expect(ratingSplit({ auto: 8.5, teleop: "n/a", endgame: 3 })).toBeNull();
    expect(ratingSplit({ auto: Number.NaN, teleop: 1, endgame: 1 })).toBeNull();
    // A negative component is not a width.
    expect(ratingSplit({ auto: -4, teleop: 10, endgame: 2 })).toBeNull();
  });

  it("accepts numeric strings, which is how jsonb payloads arrive", () => {
    const split = ratingSplit({ auto: "8.5", teleop: "31.8", endgame: "14.6" })!;
    expect(split.total).toBeCloseTo(54.9, 5);
  });
});

describe("splitWidths", () => {
  it("always adds to exactly 100% so no track shows through", () => {
    for (const input of [
      { auto: 8.5, teleop: 31.8, endgame: 14.6 },
      { auto: 1, teleop: 1, endgame: 1 },
      { auto: 0.1, teleop: 99.8, endgame: 0.1 },
      { auto: 7, teleop: 7, endgame: 8 },
    ]) {
      const widths = splitWidths(ratingSplit(input)!);
      const sum = widths.reduce((total, width) => total + Number.parseFloat(width), 0);
      expect(Math.round(sum * 10) / 10, JSON.stringify(input)).toBe(100);
    }
  });

  it("puts the rounding drift on the largest segment, not spread over all three", () => {
    // Thirds round to 33.3 each and leave 0.1 unaccounted.
    const widths = splitWidths(ratingSplit({ auto: 1, teleop: 1, endgame: 1 })!);
    expect(widths.filter((w) => w === "33.3%")).toHaveLength(2);
    expect(widths).toContain("33.4%");
  });
});

describe("ratingValue", () => {
  it("shows one decimal and an em dash for nothing", () => {
    expect(ratingValue(54.9)).toBe("54.9");
    expect(ratingValue(0)).toBe("0.0");
    expect(ratingValue(null)).toBe("—");
    expect(ratingValue(undefined)).toBe("—");
    expect(ratingValue(Number.NaN)).toBe("—");
  });
});
