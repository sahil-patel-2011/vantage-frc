import { describe, expect, it } from "vitest";
import { parseWeightAction, summarizeWeight, validateComponent } from "./weight-budget";

describe("validateComponent", () => {
  it("requires a name and non-negative weight", () => {
    expect(validateComponent({ weightLbs: 5 }).ok).toBe(false);
    expect(validateComponent({ name: "Gearbox", weightLbs: -1 }).ok).toBe(false);
  });
  it("rejects a non-positive quantity", () => {
    expect(validateComponent({ name: "Gearbox", weightLbs: 5, quantity: 0 }).ok).toBe(false);
  });
  it("defaults quantity to 1", () => {
    const result = validateComponent({ name: "Gearbox", weightLbs: 5 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.quantity).toBe(1);
  });
});

describe("summarizeWeight", () => {
  it("sums weight × quantity and computes remaining margin", () => {
    const summary = summarizeWeight(
      [
        { subsystem: "Drivetrain", weightLbs: 10, quantity: 4 },
        { subsystem: "Arm", weightLbs: 15, quantity: 1 },
      ],
      125,
    );
    expect(summary.totalLbs).toBe(55); // 40 + 15
    expect(summary.remainingLbs).toBe(70);
    expect(summary.overLimit).toBe(false);
    expect(summary.percentUsed).toBe(44);
    expect(summary.bySubsystem[0]).toEqual({ subsystem: "Drivetrain", lbs: 40 });
  });
  it("flags going over the limit", () => {
    const summary = summarizeWeight([{ subsystem: "", weightLbs: 130, quantity: 1 }], 125);
    expect(summary.overLimit).toBe(true);
    expect(summary.remainingLbs).toBe(-5);
    expect(summary.bySubsystem[0]!.subsystem).toBe("Unassigned");
  });
});

describe("parseWeightAction", () => {
  it("parses create_component with a season year", () => {
    const action = parseWeightAction({ action: "create_component", orgId: "o1", seasonYear: 2026, name: "Gearbox", weightLbs: 5 });
    expect(action).toMatchObject({ action: "create_component", name: "Gearbox" });
  });
  it("parses set_limit and rejects a non-positive limit", () => {
    expect(parseWeightAction({ action: "set_limit", orgId: "o1", seasonYear: 2026, limitLbs: 120 })).toMatchObject({ action: "set_limit", limitLbs: 120 });
    expect(() => parseWeightAction({ action: "set_limit", orgId: "o1", seasonYear: 2026, limitLbs: 0 })).toThrow();
  });
  it("rejects an unsupported action", () => {
    expect(() => parseWeightAction({ action: "levitate", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
