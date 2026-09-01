import { describe, expect, it } from "vitest";
import {
  COST_POSITIVE,
  COST_REQUIRED,
  JUSTIFICATION_REQUIRED,
  NEEDED_BY_INVALID,
  TITLE_REQUIRED,
  validateBuySheet,
} from "./buy-sheet";

function sheet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "NEO 550",
    justification: "Drivetrain spare before district",
    neededBy: "2026-09-15",
    costUsd: 42.5,
    ...overrides,
  };
}

describe("validateBuySheet", () => {
  it("accepts what / why / when / positive cost", () => {
    const result = validateBuySheet(sheet());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        title: "NEO 550",
        justification: "Drivetrain spare before district",
        neededBy: "2026-09-15",
        costUsd: 42.5,
      });
    }
  });

  it("trims title and justification", () => {
    const result = validateBuySheet(sheet({ title: "  Bearings  ", justification: "  Swerve rebuild  " }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Bearings");
      expect(result.value.justification).toBe("Swerve rebuild");
    }
  });

  it("rejects a missing or blank title (what)", () => {
    expect(validateBuySheet(sheet({ title: "" })).ok).toBe(false);
    const missing = validateBuySheet({ justification: "Need it", costUsd: 10 });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe(TITLE_REQUIRED);
  });

  it("rejects a missing or blank justification (why)", () => {
    const blank = validateBuySheet(sheet({ justification: "   " }));
    expect(blank.ok).toBe(false);
    if (!blank.ok) expect(blank.error).toBe(JUSTIFICATION_REQUIRED);
  });

  it("accepts an empty neededBy (when) as null", () => {
    expect(validateBuySheet(sheet({ neededBy: "" })).ok).toBe(true);
    expect(validateBuySheet(sheet({ neededBy: "   " })).ok).toBe(true);
    const omitted = validateBuySheet({
      title: "Hex shaft",
      justification: "Chassis rails",
      costUsd: 18,
    });
    expect(omitted.ok).toBe(true);
    if (omitted.ok) expect(omitted.value.neededBy).toBeNull();
  });

  it("rejects a non-ISO neededBy", () => {
    const result = validateBuySheet(sheet({ neededBy: "09/15/2026" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(NEEDED_BY_INVALID);
  });

  it("rejects an empty cost", () => {
    for (const costUsd of [undefined, null, "", "   "]) {
      const result = validateBuySheet(sheet({ costUsd }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(COST_REQUIRED);
    }
    const missing = validateBuySheet({ title: "Wire", justification: "Pit spare" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe(COST_REQUIRED);
  });

  it("rejects zero, negative, and non-finite cost", () => {
    expect(validateBuySheet(sheet({ costUsd: 0 })).ok).toBe(false);
    expect(validateBuySheet(sheet({ costUsd: -1 })).ok).toBe(false);
    expect(validateBuySheet(sheet({ costUsd: "0.001" })).ok).toBe(false);
    const garbage = validateBuySheet(sheet({ costUsd: "free" }));
    expect(garbage.ok).toBe(false);
    if (!garbage.ok) expect(garbage.error).toBe(COST_POSITIVE);
  });

  it("accepts finance unitCostUsd and orders estimateUsd aliases", () => {
    const finance = validateBuySheet({
      title: "NEO 550",
      justification: "Drivetrain spare",
      needed_by: "2026-10-01",
      unitCostUsd: "12.005",
    });
    expect(finance.ok).toBe(true);
    if (finance.ok) {
      expect(finance.value.neededBy).toBe("2026-10-01");
      expect(finance.value.costUsd).toBe(12.01);
    }

    const orders = validateBuySheet({
      title: "Bearings",
      justification: "Swerve modules",
      estimateUsd: 42.5,
    });
    expect(orders.ok).toBe(true);
    if (orders.ok) expect(orders.value.costUsd).toBe(42.5);
  });

  it("accepts what / why / when / cost aliases", () => {
    const result = validateBuySheet({
      what: "Shaft stock",
      why: "Bumper mounts",
      when: "2026-11-02",
      cost: 8,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe("Shaft stock");
      expect(result.value.justification).toBe("Bumper mounts");
      expect(result.value.neededBy).toBe("2026-11-02");
      expect(result.value.costUsd).toBe(8);
    }
  });
});
