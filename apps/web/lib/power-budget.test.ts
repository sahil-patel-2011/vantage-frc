import { describe, expect, it } from "vitest";
import { parsePowerAction, summarizePower, validateLoad } from "./power-budget";

describe("validateLoad", () => {
  it("requires a name", () => {
    expect(validateLoad({ typicalAmps: 20 }).ok).toBe(false);
  });
  it("rejects negative currents", () => {
    expect(validateLoad({ name: "Drive", typicalAmps: -5 }).ok).toBe(false);
    expect(validateLoad({ name: "Drive", breakerAmps: -1 }).ok).toBe(false);
  });
  it("accepts a valid load", () => {
    const result = validateLoad({ name: "Drivetrain", typicalAmps: 40, peakAmps: 120, breakerAmps: 40, motorCount: 4 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.peakAmps).toBe(120);
  });
});

describe("summarizePower", () => {
  it("totals draw and flags a branch whose peak exceeds its breaker", () => {
    const summary = summarizePower([
      { name: "Drivetrain", typicalAmps: 40, peakAmps: 60, breakerAmps: 40 },
      { name: "Intake", typicalAmps: 15, peakAmps: 25, breakerAmps: 30 },
    ]);
    expect(summary.totalTypicalAmps).toBe(55);
    expect(summary.totalPeakAmps).toBe(85);
    expect(summary.tripRisks).toEqual(["Drivetrain"]); // 60 > 40 breaker
  });

  it("flags brownout risk when typical draw exceeds the sustained ceiling", () => {
    const heavy = summarizePower([{ name: "All motors", typicalAmps: 130, peakAmps: null, breakerAmps: null }], 100);
    expect(heavy.brownoutRisk).toBe(true);
    const light = summarizePower([{ name: "All motors", typicalAmps: 60, peakAmps: null, breakerAmps: null }], 100);
    expect(light.brownoutRisk).toBe(false);
  });

  it("has no trip risk when peaks stay within breakers", () => {
    const summary = summarizePower([{ name: "Drive", typicalAmps: 30, peakAmps: 38, breakerAmps: 40 }]);
    expect(summary.tripRisks).toEqual([]);
  });
});

describe("parsePowerAction", () => {
  it("parses create_load with a season year", () => {
    const action = parsePowerAction({ action: "create_load", orgId: "o1", seasonYear: 2026, name: "Drive", typicalAmps: 40 });
    expect(action.action).toBe("create_load");
    expect(action).toMatchObject({ name: "Drive" });
  });
  it("rejects create_load without a season year", () => {
    expect(() => parsePowerAction({ action: "create_load", orgId: "o1", name: "Drive" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parsePowerAction({ action: "overclock", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
