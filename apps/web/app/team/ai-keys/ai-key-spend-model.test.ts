import { describe, expect, it } from "vitest";
import { describeKeySpend, formatUsd, limitResetsOn } from "./ai-key-spend-model";

describe("describeKeySpend", () => {
  it("shows spend with no bar or percent when a key is unlimited", () => {
    const view = describeKeySpend({ monthSpendUsd: "1.234567", monthlyLimitUsd: null });
    expect(view.limitText).toBe("Unlimited");
    expect(view.spentText).toBe("$1.23");
    expect(view.percent).toBeNull();
    expect(view.reached).toBe(false);
  });

  it("gives the share of the limit used and a bar capped at full", () => {
    expect(describeKeySpend({ monthSpendUsd: "2.5", monthlyLimitUsd: "10" })).toMatchObject({ percent: 25, barPercent: 25, level: "low", reached: false });
    expect(describeKeySpend({ monthSpendUsd: "8", monthlyLimitUsd: "10" })).toMatchObject({ percent: 80, level: "high" });
    // A call that started under the limit can finish past it: say so, keep the bar full.
    expect(describeKeySpend({ monthSpendUsd: "10.3", monthlyLimitUsd: "10" })).toMatchObject({ percent: 103, barPercent: 100, level: "full", reached: true });
  });

  it("treats a $0 limit as a key switched off for the month", () => {
    expect(describeKeySpend({ monthSpendUsd: "0", monthlyLimitUsd: "0" })).toMatchObject({ reached: true, barPercent: 100, percent: 100 });
  });

  it("never invents spend from a missing value", () => {
    expect(describeKeySpend({})).toMatchObject({ spent: 0, limit: null, spentText: "$0.00" });
  });
});

describe("formatUsd", () => {
  it("keeps tiny real spend visible", () => {
    expect(formatUsd(0.0004)).toBe("<$0.01");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });
});

describe("limitResetsOn", () => {
  it("names the 1st of next month, across a year end", () => {
    expect(limitResetsOn(new Date(2026, 11, 20))).toBe(new Date(2027, 0, 1).toLocaleDateString(undefined, { month: "long", day: "numeric" }));
  });
});
