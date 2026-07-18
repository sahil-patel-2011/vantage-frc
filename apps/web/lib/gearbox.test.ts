import { describe, expect, it } from "vitest";
import { compoundReduction, describeStages, outputRpm, parseGearboxAction, torqueMultiplier, validateGearbox, validateStages } from "./gearbox";

describe("validateStages", () => {
  it("requires at least one stage", () => {
    expect(validateStages([]).ok).toBe(false);
  });
  it("rejects non-positive tooth counts", () => {
    expect(validateStages([{ driving: 0, driven: 60 }]).ok).toBe(false);
    expect(validateStages([{ driving: 12, driven: -1 }]).ok).toBe(false);
  });
  it("accepts valid stages", () => {
    expect(validateStages([{ driving: 12, driven: 60 }]).ok).toBe(true);
  });
});

describe("compoundReduction", () => {
  it("computes a single stage", () => {
    expect(compoundReduction([{ driving: 12, driven: 60 }])).toBe(5);
  });
  it("multiplies stages", () => {
    // 12:60 (5:1) then 14:42 (3:1) = 15:1
    expect(compoundReduction([{ driving: 12, driven: 60 }, { driving: 14, driven: 42 }])).toBe(15);
  });
});

describe("outputRpm & torque", () => {
  it("divides input RPM by the reduction", () => {
    expect(outputRpm(6000, 15)).toBe(400);
  });
  it("returns null for bad inputs", () => {
    expect(outputRpm(0, 15)).toBeNull();
    expect(outputRpm(6000, 0)).toBeNull();
  });
  it("torque multiplies by the reduction", () => {
    expect(torqueMultiplier(15)).toBe(15);
  });
});

describe("describeStages", () => {
  it("renders a readable chain", () => {
    expect(describeStages([{ driving: 12, driven: 60 }, { driving: 14, driven: 42 }])).toBe("12:60 → 14:42");
  });
});

describe("validateGearbox / parseGearboxAction", () => {
  it("requires a name and valid stages", () => {
    expect(validateGearbox({ stages: [{ driving: 12, driven: 60 }] }).ok).toBe(false);
    expect(validateGearbox({ name: "SDS MK4i", stages: [] }).ok).toBe(false);
  });
  it("parses save_gearbox with a season year", () => {
    const action = parseGearboxAction({ action: "save_gearbox", orgId: "o1", seasonYear: 2026, name: "MK4i L2", stages: [{ driving: 14, driven: 50 }, { driving: 27, driven: 17 }, { driving: 15, driven: 45 }] });
    expect(action).toMatchObject({ action: "save_gearbox", name: "MK4i L2" });
  });
  it("rejects an unsupported action", () => {
    expect(() => parseGearboxAction({ action: "strip_gears", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
