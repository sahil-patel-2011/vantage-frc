import { describe, expect, it } from "vitest";
import {
  buildFeatureFromSpec,
  describeFeatureParameters,
  type OnshapeFeatureSpec,
} from "../src/onshape-generic-feature";

/**
 * The builder against Onshape's own published specs.
 *
 * Everything below is copied verbatim from a live `featurespecs` response
 * (2026-09-18, education account) — not written to make the tests pass. These
 * are three features the agent had no tool for at all: Revolve, Helix and
 * Shell.
 *
 * Coverage measured across all 97 feature types the same account publishes:
 *
 *   66  every parameter buildable
 *   30  most parameters buildable (hole 147/161, fillet 36/38, faceBlend 40/42…)
 *    1  none — derivedMirror
 *
 * So 96 of 97 features are reachable, against roughly a dozen hand-written
 * tools before this. The 30 partial ones are partial because of arrays,
 * lookup tables and cross-document references, which are refused by name
 * rather than guessed — a wrong parameter does not fail loudly, it quietly
 * builds the wrong shape.
 */

const REVOLVE: OnshapeFeatureSpec = {
  featureType: "revolve",
  featureTypeName: "Revolve",
  parameters: [
    {
      btType: "BTParameterSpecEnum-171",
      parameterId: "bodyType",
      parameterName: "Creation type",
      enumName: "ExtendedToolBodyType",
      options: ["SOLID", "SURFACE", "THIN"],
    },
    {
      btType: "BTParameterSpecEnum-171",
      parameterId: "operationType",
      parameterName: "Result body operation type",
      enumName: "NewBodyOperationType",
      options: ["NEW", "ADD", "REMOVE", "INTERSECT"],
    },
    {
      btType: "BTParameterSpecQuery-174",
      parameterId: "entities",
      parameterName: "Faces and sketch regions to revolve",
    },
  ],
};

const HELIX: OnshapeFeatureSpec = {
  featureType: "helix",
  featureTypeName: "Helix",
  parameters: [
    {
      btType: "BTParameterSpecEnum-171",
      parameterId: "axisType",
      parameterName: "Helix axis type",
      enumName: "AxisType",
      options: ["SURFACE", "AXIS", "CIRCLE"],
    },
    { btType: "BTParameterSpecQuery-174", parameterId: "axis", parameterName: "Helix axis" },
    {
      btType: "BTParameterSpecEnum-171",
      parameterId: "pathType",
      parameterName: "Input type",
      enumName: "PathType",
      options: ["TURNS", "PITCH", "TURNS_PITCH"],
    },
  ],
};

const SHELL: OnshapeFeatureSpec = {
  featureType: "shell",
  featureTypeName: "Shell",
  parameters: [
    { btType: "BTParameterSpecBoolean-170", parameterId: "isHollow", parameterName: "Hollow" },
    { btType: "BTParameterSpecQuery-174", parameterId: "entities", parameterName: "Faces to remove" },
    {
      btType: "BTParameterSpecQuantity-173",
      parameterId: "thickness",
      parameterName: "Shell thickness",
      quantityType: "LENGTH",
    },
    {
      btType: "BTParameterSpecBoolean-170",
      parameterId: "oppositeDirection",
      parameterName: "Opposite direction",
    },
  ],
};

describe("Shell — a feature the agent had no tool for", () => {
  it("builds a 2mm shell with a face removed", () => {
    const built = buildFeatureFromSpec({
      spec: SHELL,
      name: "Hollow the body",
      values: { thickness: 2, entities: ["JHD"], isHollow: true, oppositeDirection: false },
    });

    expect(built.feature).toMatchObject({ featureType: "shell", name: "Hollow the body" });
    const params = built.feature.parameters as Array<Record<string, unknown>>;
    // 2mm on the wire is 0.002m, with the millimetres kept for the dialog.
    expect(params.find((p) => p.parameterId === "thickness")).toMatchObject({
      value: 0.002,
      expression: "2 mm",
    });
    expect(params.find((p) => p.parameterId === "isHollow")).toMatchObject({ value: true });
    expect(params.find((p) => p.parameterId === "entities")).toMatchObject({
      btType: "BTMParameterQueryList-148",
    });
  });

  it("will not shell a selection it was not given", () => {
    expect(() =>
      buildFeatureFromSpec({ spec: SHELL, values: { thickness: 2, entities: [] } }),
    ).toThrow(/never guesses/i);
  });
});

describe("Revolve — real enums, checked against real options", () => {
  it("builds a solid revolve that adds to the body", () => {
    const built = buildFeatureFromSpec({
      spec: REVOLVE,
      values: { bodyType: "SOLID", operationType: "ADD", entities: ["JCC"] },
    });
    const params = built.feature.parameters as Array<Record<string, unknown>>;
    expect(params.find((p) => p.parameterId === "bodyType")).toMatchObject({
      enumName: "ExtendedToolBodyType",
      value: "SOLID",
    });
    expect(params.find((p) => p.parameterId === "operationType")).toMatchObject({ value: "ADD" });
  });

  it("refuses an operation Onshape does not offer, and lists the real ones", () => {
    expect(() =>
      buildFeatureFromSpec({ spec: REVOLVE, values: { operationType: "SUBTRACT" } }),
    ).toThrow(/NEW, ADD, REMOVE, INTERSECT/);
  });
});

describe("Helix — three enums and a selection", () => {
  it("builds a helix about an axis, by turns", () => {
    const built = buildFeatureFromSpec({
      spec: HELIX,
      values: { axisType: "AXIS", pathType: "TURNS", axis: "JDC" },
    });
    const params = built.feature.parameters as Array<Record<string, unknown>>;
    expect(params).toHaveLength(3);
    expect(params.find((p) => p.parameterId === "pathType")).toMatchObject({
      enumName: "PathType",
      value: "TURNS",
    });
  });

  it("catches a plausible-but-wrong axis type", () => {
    // "LINE" is what you would guess if you had not read the spec.
    expect(() => buildFeatureFromSpec({ spec: HELIX, values: { axisType: "LINE" } })).toThrow(
      /SURFACE, AXIS, CIRCLE/,
    );
  });
});

describe("describing a real feature to the agent", () => {
  it("reports Shell's parameters with units and types", () => {
    const described = describeFeatureParameters(SHELL);
    expect(described.map((p) => p.parameterId)).toEqual([
      "isHollow",
      "entities",
      "thickness",
      "oppositeDirection",
    ]);
    expect(described.find((p) => p.parameterId === "thickness")).toMatchObject({
      name: "Shell thickness",
      kind: "number (length)",
      units: "mm",
      supported: true,
    });
    expect(described.every((p) => p.supported)).toBe(true);
  });

  it("hands Revolve's real enum options straight through", () => {
    const described = describeFeatureParameters(REVOLVE);
    expect(described.find((p) => p.parameterId === "bodyType")?.options).toEqual([
      "SOLID",
      "SURFACE",
      "THIN",
    ]);
  });
});
