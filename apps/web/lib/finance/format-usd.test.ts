import { describe, expect, it } from "vitest";
import { formatUsd, formatUsdCents } from "./format-usd";

describe("formatUsd", () => {
  it("writes cents whenever there are cents, never a lone tenth", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(2134.75)).toBe("$2,134.75");
    expect(formatUsd(0.01)).toBe("$0.01");
  });

  it("writes whole dollars without padding", () => {
    expect(formatUsd(25000)).toBe("$25,000");
    expect(formatUsd(0)).toBe("$0");
  });

  it("keeps the same figure identical wherever it is printed", () => {
    // 25,000 − 2,134.75: the QA page showed "$22,865" beside "$2,134.75".
    expect(formatUsd(25000 - 2134.75)).toBe("$22,865.25");
    expect(formatUsd("2134.75")).toBe(formatUsdCents(213475));
  });

  it("reads numeric text and refuses to invent money from garbage", () => {
    expect(formatUsd("1234.50")).toBe("$1,234.50");
    expect(formatUsd("abc")).toBe("$0");
    expect(formatUsd(null)).toBe("$0");
    expect(formatUsd(Number.NaN)).toBe("$0");
  });

  it("shows a real negative and never a negative zero", () => {
    expect(formatUsd(-1241.76)).toBe("-$1,241.76");
    expect(formatUsdCents(-0)).toBe("$0");
  });
});
