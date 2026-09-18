import { describe, expect, it } from "vitest";
import {
  buildFeatureFromSpec,
  buildParameterFromSpec,
  describeFeatureParameters,
  type OnshapeFeatureSpec,
} from "../src/onshape-generic-feature";

/**
 * Spec fragments below are copied from a live `featurespecs` response
 * (2026-09-18, education account, 97 feature types) rather than invented, so
 * the btType strings and quantityType values are Onshape's own.
 */

const LENGTH = {
  btType: "BTParameterSpecQuantity-173",
  parameterId: "depth",
  parameterName: "Depth",
  quantityType: "LENGTH",
};

const ANGLE = {
  btType: "BTParameterSpecQuantity-173",
  parameterId: "angle",
  quantityType: "ANGLE",
};

const INTEGER = {
  btType: "BTParameterSpecQuantity-173",
  parameterId: "instanceCount",
  quantityType: "INTEGER",
};

const REAL = {
  btType: "BTParameterSpecQuantity-173",
  parameterId: "scale",
  quantityType: "REAL",
};

const BOOLEAN = {
  btType: "BTParameterSpecBoolean-170",
  parameterId: "oppositeDirection",
};

const ENUM = {
  btType: "BTParameterSpecEnum-171",
  parameterId: "domain",
  enumName: "OperationDomain",
  options: ["MODEL", "FLAT"],
};

const QUERY = {
  btType: "BTParameterSpecQuery-174",
  parameterId: "entities",
};

const LOFT: OnshapeFeatureSpec = {
  featureType: "loft",
  featureTypeName: "Loft",
  parameters: [LENGTH, ANGLE, INTEGER, REAL, BOOLEAN, ENUM, QUERY],
};

describe("units cross the wire the way Onshape stores them", () => {
  it("sends a length in metres and keeps the millimetres a student typed", () => {
    // Onshape's internal length unit is metres; the expression is what shows
    // in the feature dialog, so it has to stay in the units the person used.
    expect(buildParameterFromSpec(LENGTH, 25)).toMatchObject({
      btType: "BTMParameterQuantity-147",
      value: 0.025,
      expression: "25 mm",
      parameterId: "depth",
    });
  });

  it("sends an angle in radians and keeps the degrees", () => {
    const built = buildParameterFromSpec(ANGLE, 90) as { value: number; expression: string };
    expect(built.value).toBeCloseTo(Math.PI / 2, 10);
    expect(built.expression).toBe("90 deg");
  });

  it("marks an integer parameter as one", () => {
    expect(buildParameterFromSpec(INTEGER, 4)).toMatchObject({ isInteger: true, value: 4 });
  });

  it("refuses a fractional count rather than rounding it", () => {
    expect(() => buildParameterFromSpec(INTEGER, 2.5)).toThrow(/whole number/i);
  });

  it("leaves a unitless REAL alone — it is a ratio, not a measurement", () => {
    expect(buildParameterFromSpec(REAL, 1.5)).toMatchObject({
      value: 1.5,
      units: "",
      expression: "1.5",
      isInteger: false,
    });
  });
});

describe("enums are checked against the options Onshape published", () => {
  it("accepts a published option and carries the enum name", () => {
    expect(buildParameterFromSpec(ENUM, "FLAT")).toEqual({
      btType: "BTMParameterEnum-145",
      enumName: "OperationDomain",
      value: "FLAT",
      parameterId: "domain",
    });
  });

  it("matches case-insensitively but sends Onshape its own spelling", () => {
    expect(buildParameterFromSpec(ENUM, "model")).toMatchObject({ value: "MODEL" });
  });

  it("refuses a value that is not an option, and says what is", () => {
    expect(() => buildParameterFromSpec(ENUM, "SOLID")).toThrow(/MODEL, FLAT/);
  });
});

describe("geometry is never guessed", () => {
  it("takes resolved deterministic ids", () => {
    expect(buildParameterFromSpec(QUERY, ["JHD", "JHE"])).toMatchObject({
      btType: "BTMParameterQueryList-148",
      queries: [{ deterministicIds: ["JHD", "JHE"] }],
    });
  });

  it("accepts a single id without making the caller wrap it", () => {
    const built = buildParameterFromSpec(QUERY, "JHD") as { queries: Array<{ deterministicIds: string[] }> };
    expect(built.queries[0]?.deterministicIds).toEqual(["JHD"]);
  });

  it("refuses an empty selection instead of building a feature that selects nothing", () => {
    expect(() => buildParameterFromSpec(QUERY, [])).toThrow(/never guesses/i);
    expect(() => buildParameterFromSpec(QUERY, ["  "])).toThrow(/never guesses/i);
  });
});

describe("booleans", () => {
  it("takes a real boolean", () => {
    expect(buildParameterFromSpec(BOOLEAN, true)).toEqual({
      btType: "BTMParameterBoolean-144",
      value: true,
      parameterId: "oppositeDirection",
    });
  });

  it("refuses a truthy string, which is how a checkbox silently ends up on", () => {
    expect(() => buildParameterFromSpec(BOOLEAN, "false")).toThrow(/true or false/i);
  });
});

describe("assembling a whole feature", () => {
  it("builds the payload the features endpoint expects", () => {
    const built = buildFeatureFromSpec({
      spec: LOFT,
      name: "Nose cone",
      values: { depth: 40, oppositeDirection: true, domain: "MODEL" },
    });
    expect(built.btType).toBe("BTFeatureDefinitionCall-1406");
    expect(built.feature).toMatchObject({
      btType: "BTMFeature-134",
      featureType: "loft",
      name: "Nose cone",
      suppressed: false,
    });
    expect((built.feature.parameters as unknown[]).length).toBe(3);
  });

  it("omits what the caller omitted, so Onshape applies its own defaults", () => {
    // Same thing the UI does when you accept a dialog without touching a field.
    const built = buildFeatureFromSpec({ spec: LOFT, values: { depth: 10 } });
    expect((built.feature.parameters as unknown[]).length).toBe(1);
  });

  it("falls back to Onshape's own name for the feature", () => {
    expect(buildFeatureFromSpec({ spec: LOFT, values: {} }).feature.name).toBe("Loft");
  });

  it("names the parameters a feature does accept when given one it does not", () => {
    // The failure mode this prevents: a typo'd id silently doing nothing.
    expect(() => buildFeatureFromSpec({ spec: LOFT, values: { dpeth: 10 } })).toThrow(
      /has no parameter "dpeth"[\s\S]*accepts:/,
    );
  });
});

describe("the parameter kinds it deliberately will not guess", () => {
  it("refuses an array parameter by name rather than inventing a shape", () => {
    expect(() =>
      buildParameterFromSpec(
        { btType: "BTParameterSpecArray-2600", parameterId: "bends" },
        [1, 2],
      ),
    ).toThrow(/repeating array/i);
  });

  it("refuses a lookup-table path", () => {
    expect(() =>
      buildParameterFromSpec({ btType: "BTParameterSpecLookupTablePath-761", parameterId: "size" }, "M4"),
    ).toThrow(/lookup-table/i);
  });
});

describe("describing a feature before building one", () => {
  it("says what each parameter takes, and which it can set", () => {
    const described = describeFeatureParameters(LOFT);
    expect(described.find((p) => p.parameterId === "depth")).toMatchObject({
      kind: "number (length)",
      units: "mm",
      supported: true,
    });
    expect(described.find((p) => p.parameterId === "angle")?.units).toBe("degrees");
    expect(described.find((p) => p.parameterId === "domain")?.options).toEqual(["MODEL", "FLAT"]);
    expect(described.find((p) => p.parameterId === "entities")?.kind).toBe("geometry selection");
  });

  it("marks the kinds it cannot set, so the agent does not try", () => {
    const described = describeFeatureParameters({
      featureType: "sheetMetalFlange",
      parameters: [{ btType: "BTParameterSpecArray-2600", parameterId: "bends" }],
    });
    expect(described[0]).toMatchObject({ supported: false });
    expect(described[0]?.kind).toMatch(/array/i);
  });

  it("handles a spec with no parameters rather than throwing", () => {
    expect(describeFeatureParameters({ featureType: "cube" })).toEqual([]);
  });
});
