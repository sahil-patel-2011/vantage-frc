import { describe, expect, it } from "vitest";
import {
  formatOnshapeLength, parseAngle, parseLength, reviewDrawingPlan, validatePhysicalEvidence,
  type PhysicalEvidence,
} from "../src/onshape-ui/intent";

describe("browser CAD dimension contracts", () => {
  it.each([["1 mm", 1], ["1cm", 10], ["1 m", 1000], ["1 in", 25.4], ["1 ft", 304.8]])(
    "normalizes %s without depending on document units", (input, millimeters) => {
      expect(parseLength(input as string).millimeters).toBe(millimeters);
    },
  );
  it.each(["25", "1/2 in", "2 inches", "0 mm", "-1 mm", "NaN mm", "Infinity mm", "1e309 mm", "1e308 m", "1e-999 mm", "3 deg"])(
    "rejects missing, ambiguous or invalid dimensions: %s", (input) => expect(() => parseLength(input)).toThrow(),
  );
  it("supports signed angles but requires angular units", () => {
    expect(parseAngle("-90 deg").radians).toBeCloseTo(-Math.PI / 2);
    expect(parseAngle("0 rad").radians).toBe(0);
    expect(() => parseAngle("90")).toThrow();
    expect(() => parseAngle("90 mm")).toThrow();
    expect(formatOnshapeLength("2 in")).toBe("50.8 mm");
  });
  it("blocks the entire plan when one needed dimension is missing", () => {
    const result = reviewDrawingPlan([
      { key: "width", label: "plate width", kind: "length", value: "2 in", source: "drawing_annotation" },
      { key: "thickness", label: "plate thickness", kind: "length" },
    ]);
    expect(result.status).toBe("clarification");
    expect(result).not.toHaveProperty("dimensions");
    if (result.status === "clarification") expect(result.questions[0]?.key).toBe("thickness");
  });
  it("does not accept a dimension merely because a model inferred its value", () => {
    expect(reviewDrawingPlan([{ key: "width", label: "width", kind: "length", value: "50 mm" }]).status).toBe("clarification");
    expect(reviewDrawingPlan([]).status).toBe("clarification");
  });
  it("preserves explicit dimensions and rejects duplicate identities", () => {
    const dimension = { key: "width", label: "width", kind: "length", value: "2 in", source: "user" } as const;
    expect(reviewDrawingPlan([dimension])).toEqual({ status: "ready", dimensions: [{ key: "width", input: "50.8 mm", kind: "length" }] });
    expect(() => reviewDrawingPlan([dimension, dimension])).toThrow("unique keys");
  });
});

describe("physical property evidence", () => {
  const context = { source: "onshape_ui", observedText: "Mass: 2 kg", material: "Aluminum 6061", referenceFrame: "Center of mass, document axes", selection: "Part 1" } as const;
  it("requires material, selection, reference frame and observed UI text", () => {
    const evidence = { ...context, kind: "mass", value: 2, unit: "kg" } as const;
    expect(validatePhysicalEvidence(evidence)).toBe(evidence);
    for (const field of ["material", "selection", "referenceFrame", "observedText"] as const) {
      expect(() => validatePhysicalEvidence({ ...evidence, [field]: " " })).toThrow();
    }
    expect(() => validatePhysicalEvidence({ ...evidence, value: NaN })).toThrow();
    expect(() => validatePhysicalEvidence({ ...evidence, source: "screenshot_estimate" } as unknown as PhysicalEvidence)).toThrow();
  });
  it("preserves signed cross terms with explicit inertia convention", () => {
    const evidence = { ...context, kind: "inertia", unit: "kg*m^2", convention: "inertia_tensor", components: { xx: 2, yy: 3, zz: 4, xy: -0.1, xz: 0, yz: 0.1 } } as const;
    expect(validatePhysicalEvidence(evidence)).toBe(evidence);
    expect(() => validatePhysicalEvidence({ ...evidence, components: { ...evidence.components, zz: Infinity } })).toThrow();
    expect(() => validatePhysicalEvidence({ ...evidence, components: { ...evidence.components, xx: -1 } })).toThrow();
    expect(() => validatePhysicalEvidence({ ...evidence, unit: "kg" } as unknown as PhysicalEvidence)).toThrow();
  });
});
