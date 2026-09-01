import { describe, expect, it } from "vitest";
import {
  COMPOSER_NATIVE_OPS,
  COMPOSER_OP_FIELDS,
  appendComposerOp,
  composerPalette,
  describeComposerOp,
  emptyComposerParameters,
  parametersFromDraft,
  parseComposerOps,
  removeComposerOp,
  replaceComposerOp,
  requireComposerDimensions,
  requireComposerPicks,
  serializeComposerOps,
} from "./composer-ops";

describe("composer native ops", () => {
  it("keeps an empty plan as []", () => {
    expect(parseComposerOps(undefined)).toEqual([]);
    expect(parseComposerOps(null)).toEqual([]);
    expect(parseComposerOps("")).toEqual([]);
    expect(parseComposerOps("[]")).toEqual([]);
    expect(parseComposerOps([])).toEqual([]);
    expect(parseComposerOps({ steps: [] })).toEqual([]);
    expect(serializeComposerOps([])).toEqual([]);
  });

  it("rejects invalid millimetre values", () => {
    expect(() =>
      parseComposerOps([{ operation: "create_sketch", parameters: { widthMm: -5, heightMm: 10 } }]),
    ).toThrow(/millimetres/i);
    expect(() => parseComposerOps([{ operation: "create_extrude", parameters: { depthMm: "abc" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_fillet", parameters: { radiusMm: "30 mm" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_chamfer", parameters: { widthMm: "2 mm" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_shell", parameters: { thicknessMm: 0 } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_hole", parameters: { diameterMm: 0 } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_pattern", parameters: { spacingMm: "25 mm" } }])).toThrow(
      /millimetres/i,
    );
    expect(() => parseComposerOps([{ operation: "create_pattern", parameters: { instanceCount: 0 } }])).toThrow(
      /integer/i,
    );
    expect(() => parseComposerOps([{ operation: "create_pattern", parameters: { instanceCount: 1.5 } }])).toThrow(
      /integer/i,
    );
    expect(() => parseComposerOps([{ operation: "create_sketch", parameters: { widthMm: Number.NaN } }])).toThrow(
      /millimetres/i,
    );
  });

  it("does not include feature_script in the default palette", () => {
    expect(COMPOSER_NATIVE_OPS).not.toContain("feature_script");
    expect(composerPalette()).not.toContain("feature_script");
    expect(composerPalette("onshape")).not.toContain("feature_script");
    expect(composerPalette("fusion360")).not.toContain("feature_script");
    expect(composerPalette("onshape")).toEqual([...COMPOSER_NATIVE_OPS]);
    expect(COMPOSER_NATIVE_OPS).toContain("create_chamfer");
    expect(COMPOSER_NATIVE_OPS).toContain("create_shell");
    expect(COMPOSER_NATIVE_OPS).toContain("create_pattern");
    expect(COMPOSER_NATIVE_OPS).toContain("create_mirror");
    expect(COMPOSER_NATIVE_OPS).toContain("set_variable");
    expect(COMPOSER_NATIVE_OPS).toContain("delete_feature");
    expect(COMPOSER_NATIVE_OPS).toContain("export_step");
    expect(COMPOSER_NATIVE_OPS).toContain("export_stl");
    expect(COMPOSER_NATIVE_OPS).toContain("export_gltf");
    expect(COMPOSER_NATIVE_OPS).toContain("render_views");
    expect(composerPalette("onshape")).toEqual(
      expect.arrayContaining([
        "create_chamfer",
        "create_shell",
        "create_pattern",
        "create_mirror",
        "set_variable",
        "delete_feature",
        "export_stl",
        "export_gltf",
        "render_views",
      ]),
    );
    expect(composerPalette("fusion360")).toContain("create_chamfer");
    expect(composerPalette("fusion360")).toContain("export_step");
    expect(composerPalette("fusion360")).not.toContain("create_shell");
    expect(composerPalette("fusion360")).not.toContain("create_pattern");
    expect(composerPalette("fusion360")).not.toContain("create_mirror");
    expect(composerPalette("fusion360")).not.toContain("set_variable");
    expect(composerPalette("fusion360")).not.toContain("delete_feature");
    expect(composerPalette("fusion360")).not.toContain("export_stl");
    expect(composerPalette("fusion360")).not.toContain("export_gltf");
    expect(composerPalette("fusion360")).not.toContain("render_views");
    expect(COMPOSER_NATIVE_OPS).toContain("create_revolve");
    expect(COMPOSER_NATIVE_OPS).toContain("create_boolean");
    expect(composerPalette("onshape")).toEqual(expect.arrayContaining(["create_revolve", "create_boolean"]));
    expect(composerPalette("fusion360")).not.toContain("create_revolve");
    expect(composerPalette("fusion360")).not.toContain("create_boolean");
  });

  it("does not invent DEMO plate sizes for empty params", () => {
    expect(emptyComposerParameters("create_sketch")).toEqual({});
    expect(emptyComposerParameters("create_chamfer")).toEqual({});
    expect(emptyComposerParameters("create_shell")).toEqual({});
    expect(emptyComposerParameters("create_pattern")).toEqual({});
    expect(emptyComposerParameters("create_mirror")).toEqual({});
    expect(emptyComposerParameters("set_variable")).toEqual({});
    expect(emptyComposerParameters("delete_feature")).toEqual({});
    expect(() => parametersFromDraft("create_sketch", {})).toThrow(/Sketch width and height are required millimetres/);
    expect(() => parametersFromDraft("create_extrude", {})).toThrow(/Extrude depth is required millimetres/);
    expect(COMPOSER_OP_FIELDS.create_extrude).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "sketchFeatureId",
          kind: "idList",
          help: "Sketch feature id from the Vantage feature tree. Leave blank to use the last sketch this session created.",
        }),
      ]),
    );
    expect(COMPOSER_OP_FIELDS.create_mate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "mateType",
          kind: "select",
          options: [
            { value: "FASTENED", label: "Fastened" },
            { value: "REVOLUTE", label: "Revolute" },
            { value: "SLIDER", label: "Slider" },
            { value: "CYLINDRICAL", label: "Cylindrical" },
          ],
        }),
        expect.objectContaining({
          key: "firstInstanceId",
          kind: "idList",
          help: "Instance ids from list-onshape-assembly.",
        }),
        expect.objectContaining({
          key: "secondInstanceId",
          kind: "idList",
          help: "Instance ids from list-onshape-assembly.",
        }),
        expect.objectContaining({
          key: "firstFaceId",
          kind: "idList",
          help: "Face ids from list-onshape-entities.",
        }),
        expect.objectContaining({
          key: "secondFaceId",
          kind: "idList",
          help: "Face ids from list-onshape-entities.",
        }),
      ]),
    );
  });

  it("round-trips typed native ops and drops feature_script", () => {
    const plan = parseComposerOps([
      {
        operation: "create_sketch",
        parameters: { width: 80, height: 40, plane: "Top" },
        reason: "Base profile",
      },
      { operation: "feature_script", parameters: { source: "opExtrude" }, reason: "escape hatch" },
      { operation: "create_fillet", parameters: { radiusMm: 2, entities: "E1, E2" }, reason: "Break edges" },
      { operation: "create_chamfer", parameters: { width: 1, entities: "E3" }, reason: "Lead-in" },
      { operation: "create_shell", parameters: { thickness: 2, faceIds: "F1" }, reason: "Hollow" },
      { operation: "create_hole", parameters: { diameterMm: 5, faceIds: "F2, F3", bodyIds: "B1" }, reason: "Through holes" },
      {
        operation: "create_pattern",
        parameters: { features: "FHole", count: 4, spacing: 25, direction: "X" },
        reason: "Bolt holes",
      },
      { operation: "create_mirror", parameters: { featureIds: "FCut", plane: "Right" }, reason: "Symmetry" },
    ]);
    expect(plan.map((step) => step.operation)).toEqual([
      "create_sketch",
      "create_fillet",
      "create_chamfer",
      "create_shell",
      "create_hole",
      "create_pattern",
      "create_mirror",
    ]);
    expect(serializeComposerOps(plan)).toEqual([
      {
        operation: "create_sketch",
        parameters: { widthMm: 80, heightMm: 40, plane: "Top" },
        reason: "Base profile",
      },
      {
        operation: "create_fillet",
        parameters: { radiusMm: 2, entities: ["E1", "E2"] },
        reason: "Break edges",
      },
      {
        operation: "create_chamfer",
        parameters: { widthMm: 1, entities: ["E3"] },
        reason: "Lead-in",
      },
      {
        operation: "create_shell",
        parameters: { thicknessMm: 2, faceIds: ["F1"] },
        reason: "Hollow",
      },
      {
        operation: "create_hole",
        parameters: { diameterMm: 5, faceIds: ["F2", "F3"], bodyIds: ["B1"] },
        reason: "Through holes",
      },
      {
        operation: "create_pattern",
        parameters: { featureIds: ["FHole"], instanceCount: 4, spacingMm: 25, direction: "X" },
        reason: "Bolt holes",
      },
      {
        operation: "create_mirror",
        parameters: { featureIds: ["FCut"], plane: "Right" },
        reason: "Symmetry",
      },
    ]);
  });

  it("exposes hole location and scope body id lists, not FeatureScript", () => {
    expect(COMPOSER_OP_FIELDS.create_hole).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "faceIds",
          kind: "idList",
          label: "Locations",
          help: expect.stringMatching(/location|vertex|face ids Onshape already listed/i),
        }),
        expect.objectContaining({
          key: "bodyIds",
          kind: "idList",
          label: "Bodies (scope)",
          help: expect.stringMatching(/scope body ids/i),
        }),
      ]),
    );
    expect(COMPOSER_OP_FIELDS.create_hole.some((field) => field.key === "source")).toBe(false);
    expect(COMPOSER_OP_FIELDS.create_hole.some((field) => field.key === "pointSketchFeatureId")).toBe(false);
    expect(COMPOSER_OP_FIELDS.create_hole.some((field) => field.key === "targetFeatureId")).toBe(false);
    expect(COMPOSER_OP_FIELDS.create_shell).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "faceIds",
          kind: "idList",
          label: "Faces",
          help: expect.stringMatching(/required face ids to open/i),
        }),
      ]),
    );
    expect(COMPOSER_OP_FIELDS.create_shell.find((field) => field.key === "faceIds")?.help).not.toMatch(
      /leave blank|optional|closed shell/i,
    );
    expect(COMPOSER_OP_FIELDS.create_shell.some((field) => field.key === "entities")).toBe(false);
    expect(
      parametersFromDraft("create_hole", { diameterMm: "5", faceIds: "F2, F3", bodyIds: "B1" }),
    ).toEqual({
      diameterMm: 5,
      faceIds: ["F2", "F3"],
      bodyIds: ["B1"],
    });
  });

  it("exposes typed pattern and mirror fields without FeatureScript", () => {
    expect(COMPOSER_OP_FIELDS.create_pattern).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "spacingMm", kind: "mm" }),
        expect.objectContaining({ key: "instanceCount", kind: "count" }),
        expect.objectContaining({ key: "featureIds", kind: "idList" }),
        expect.objectContaining({ key: "axisIds", kind: "idList" }),
      ]),
    );
    expect(COMPOSER_OP_FIELDS.create_mirror).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "featureIds", kind: "idList" }),
        expect.objectContaining({ key: "planeIds", kind: "idList" }),
      ]),
    );
    expect(JSON.stringify(COMPOSER_OP_FIELDS.create_pattern)).not.toMatch(/featurescript|source/i);
    expect(JSON.stringify(COMPOSER_OP_FIELDS.create_mirror)).not.toMatch(/featurescript|source/i);
    expect(parametersFromDraft("create_pattern", { featureIds: "F1, F2", instanceCount: "3", spacingMm: "20" })).toEqual({
      featureIds: ["F1", "F2"],
      instanceCount: 3,
      spacingMm: 20,
    });
    expect(parseComposerOps([{ operation: "create_pattern", parameters: {} }])).toEqual([
      { id: "step-1", operation: "create_pattern", parameters: {}, reason: "" },
    ]);
    expect(parseComposerOps([{ operation: "create_mirror", parameters: {} }])).toEqual([
      { id: "step-1", operation: "create_mirror", parameters: {}, reason: "" },
    ]);
    expect(() => parametersFromDraft("create_pattern", { instanceCount: "3", spacingMm: "20" })).toThrow(
      /feature ids/i,
    );
    expect(() => parametersFromDraft("create_pattern", { featureIds: "F1" })).toThrow(
      /instance count and spacing/i,
    );
    expect(() =>
      parametersFromDraft("create_pattern", { featureIds: "F1", patternKind: "circular" }),
    ).toThrow(/axis ids/i);
    expect(
      parametersFromDraft("create_pattern", { featureIds: "F1", patternKind: "circular", axisIds: "JCYL" }),
    ).toEqual({
      featureIds: ["F1"],
      patternKind: "circular",
      axisIds: ["JCYL"],
    });
    expect(() => parametersFromDraft("create_mirror", {})).toThrow(/feature ids/i);
    expect(parametersFromDraft("create_mirror", { featureIds: "FCut" })).toEqual({ featureIds: ["FCut"] });
  });

  it("exposes set_variable as name + expression text, not FeatureScript", () => {
    expect(COMPOSER_OP_FIELDS.set_variable).toEqual([
      expect.objectContaining({ key: "name", kind: "text" }),
      expect.objectContaining({ key: "expression", kind: "text" }),
      expect.objectContaining({ key: "variableStudioElementId", kind: "text" }),
    ]);
    expect(COMPOSER_OP_FIELDS.set_variable.map(({ key, kind }) => ({ key, kind }))).toEqual([
      { key: "name", kind: "text" },
      { key: "expression", kind: "text" },
      { key: "variableStudioElementId", kind: "text" },
    ]);
    expect(COMPOSER_OP_FIELDS.set_variable.some((field) => field.key === "source")).toBe(false);
    expect(parametersFromDraft("set_variable", { name: "wallThickness", expression: "25 mm" })).toEqual({
      name: "wallThickness",
      expression: "25 mm",
    });
    expect(
      parametersFromDraft("set_variable", {
        name: "wallThickness",
        expression: "25 mm",
        variableStudioElementId: "vs-real",
      }),
    ).toEqual({
      name: "wallThickness",
      expression: "25 mm",
      variableStudioElementId: "vs-real",
    });
    expect(
      parseComposerOps([{ operation: "set_variable", parameters: { name: "holeDia", expression: "25 mm" } }]),
    ).toEqual([
      {
        id: "step-1",
        operation: "set_variable",
        parameters: { name: "holeDia", expression: "25 mm" },
        reason: "",
      },
    ]);
    expect(parseComposerOps([{ operation: "set_variable", parameters: {} }])).toEqual([
      { id: "step-1", operation: "set_variable", parameters: {}, reason: "" },
    ]);
  });

  it("refuses DEMO variable names and expressions", () => {
    expect(() => parseComposerOps([{ operation: "set_variable", parameters: { name: "DEMO" } }])).toThrow(
      /DEMO variable name/i,
    );
    expect(() => parseComposerOps([{ operation: "set_variable", parameters: { name: "demoWidth" } }])).toThrow(
      /DEMO variable name/i,
    );
    expect(() =>
      parseComposerOps([{ operation: "set_variable", parameters: { name: "wallThickness", expression: "DEMO" } }]),
    ).toThrow(/DEMO variable value/i);
    expect(() => parametersFromDraft("set_variable", { name: "demoPlate", expression: "25 mm" })).toThrow(
      /DEMO variable name/i,
    );
    expect(() => parametersFromDraft("set_variable", { name: "wallThickness", expression: "demo-1" })).toThrow(
      /DEMO variable value/i,
    );
    expect(() =>
      parametersFromDraft("set_variable", {
        name: "wallThickness",
        expression: "25 mm",
        variableStudioElementId: "DEMO",
      }),
    ).toThrow(/DEMO Variable Studio/i);
  });

  it("exposes delete_feature on Onshape only and refuses DEMO feature ids", () => {
    expect(describeComposerOp("delete_feature")).toBe("Delete feature");
    expect(COMPOSER_OP_FIELDS.delete_feature).toEqual([
      expect.objectContaining({
        key: "featureId",
        kind: "idList",
        label: "Feature ID",
        help: "Feature id from the Vantage feature tree.",
      }),
    ]);
    expect(COMPOSER_OP_FIELDS.delete_feature.some((field) => field.key === "source")).toBe(false);
    expect(JSON.stringify(COMPOSER_OP_FIELDS.delete_feature)).not.toMatch(/featurescript|source/i);
    expect(parseComposerOps([{ operation: "delete_feature", parameters: {} }])).toEqual([
      { id: "step-1", operation: "delete_feature", parameters: {}, reason: "" },
    ]);
    expect(() => parametersFromDraft("delete_feature", {})).toThrow(/feature id from the Vantage feature tree/i);
    expect(parametersFromDraft("delete_feature", { featureId: "FFillet" })).toEqual({ featureId: ["FFillet"] });
    expect(
      parseComposerOps([{ operation: "delete_feature", parameters: { featureId: "FFillet" } }]),
    ).toEqual([
      { id: "step-1", operation: "delete_feature", parameters: { featureId: "FFillet" }, reason: "" },
    ]);
    expect(() => parseComposerOps([{ operation: "delete_feature", parameters: { featureId: "DEMO" } }])).toThrow(
      /DEMO feature id/i,
    );
    expect(() => parseComposerOps([{ operation: "delete_feature", parameters: { featureId: "demoCut" } }])).toThrow(
      /DEMO feature id/i,
    );
    expect(() => parametersFromDraft("delete_feature", { featureId: "DEMO" })).toThrow(/DEMO feature id/i);
    expect(() => parametersFromDraft("delete_feature", { featureId: "demo-1" })).toThrow(/DEMO feature id/i);
  });

  it("requires millimetres on draft params and does not invent them", () => {
    expect(() => requireComposerDimensions("create_sketch", {})).toThrow(
      /Sketch width and height are required millimetres/,
    );
    expect(() => requireComposerDimensions("create_sketch", { widthMm: 80 })).toThrow(
      /Sketch width and height are required millimetres/,
    );
    expect(() => requireComposerDimensions("create_extrude", {})).toThrow(/Extrude depth is required millimetres/);
    expect(() => requireComposerDimensions("create_fillet", {})).toThrow(/Fillet radius is required millimetres/);
    expect(() => requireComposerDimensions("create_chamfer", {})).toThrow(/Chamfer width is required millimetres/);
    expect(() => requireComposerDimensions("create_shell", {})).toThrow(/Shell thickness is required millimetres/);
    expect(() => requireComposerDimensions("create_hole", {})).toThrow(/Hole diameter is required millimetres/);
    expect(() => parametersFromDraft("create_fillet", {})).toThrow(/Fillet radius is required millimetres/);
    expect(() => parametersFromDraft("create_chamfer", {})).toThrow(/Chamfer width is required millimetres/);
    expect(() => parametersFromDraft("create_shell", {})).toThrow(/Shell thickness is required millimetres/);
    expect(() => parametersFromDraft("create_hole", {})).toThrow(/Hole diameter is required millimetres/);
    expect(() => parametersFromDraft("create_sketch", { widthMm: "80" })).toThrow(
      /Sketch width and height are required millimetres/,
    );
    expect(parametersFromDraft("create_sketch", { widthMm: "80", heightMm: "40" })).toEqual({
      widthMm: 80,
      heightMm: 40,
    });
    expect(() => parametersFromDraft("create_sketch", { sketchKind: "circle" })).toThrow(
      /Circle sketches need a positive radius/,
    );
    expect(parametersFromDraft("create_sketch", { sketchKind: "circle", radiusMm: "12" })).toEqual({
      sketchKind: "circle",
      radiusMm: 12,
    });
    expect(parametersFromDraft("create_extrude", { depthMm: "6" })).toEqual({ depthMm: 6 });
    expect(parametersFromDraft("create_extrude", { depthMm: "6", sketchFeatureId: "Fsketch" })).toEqual({
      depthMm: 6,
      sketchFeatureId: ["Fsketch"],
    });
    expect(() => parametersFromDraft("create_fillet", { radiusMm: "2" })).toThrow(/edge id/i);
    expect(parametersFromDraft("create_fillet", { radiusMm: "2", entities: "E1" })).toEqual({
      radiusMm: 2,
      entities: ["E1"],
    });
    expect(() => parametersFromDraft("create_chamfer", { widthMm: "1" })).toThrow(/edge id/i);
    expect(parametersFromDraft("create_chamfer", { widthMm: "1", entities: "E3" })).toEqual({
      widthMm: 1,
      entities: ["E3"],
    });
    expect(() => parametersFromDraft("create_shell", { thicknessMm: "2" })).toThrow(/face id to open/i);
    expect(parametersFromDraft("create_shell", { thicknessMm: "2", faceIds: "F1" })).toEqual({
      thicknessMm: 2,
      faceIds: ["F1"],
    });
    expect(requireComposerDimensions("create_hole", { diameterMm: 5 })).toEqual({ diameterMm: 5 });
    expect(() => parametersFromDraft("create_hole", { diameterMm: "5" })).toThrow(/face ids and scope body ids/i);
    expect(() => parametersFromDraft("create_hole", { diameterMm: "5", faceIds: "F2" })).toThrow(
      /face ids and scope body ids/i,
    );
    expect(() => parametersFromDraft("create_mate", { firstFaceId: "JFC", secondFaceId: "JFD" })).toThrow(
      /FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL/i,
    );
    expect(() =>
      parametersFromDraft("create_mate", { firstInstanceId: "Mi1", secondInstanceId: "Mi2" }),
    ).toThrow(/FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL/i);
    expect(() =>
      parametersFromDraft("create_mate", {
        firstInstanceId: "Mi1",
        secondInstanceId: "Mi2",
        firstFaceId: "JFC",
        secondFaceId: "JFD",
      }),
    ).toThrow(/FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL/i);
    expect(
      parametersFromDraft("create_mate", {
        mateType: "FASTENED",
        firstInstanceId: "Mi1",
        secondInstanceId: "Mi2",
        firstFaceId: "JFC",
        secondFaceId: "JFD",
      }),
    ).toEqual({
      mateType: "FASTENED",
      firstInstanceId: ["Mi1"],
      secondInstanceId: ["Mi2"],
      firstFaceId: ["JFC"],
      secondFaceId: ["JFD"],
    });
    expect(
      parametersFromDraft("create_mate", {
        mateType: "slider",
        firstInstanceId: "Mi1",
        secondInstanceId: "Mi2",
        firstFaceId: "JFC",
        secondFaceId: "JFD",
      }),
    ).toEqual({
      mateType: "SLIDER",
      firstInstanceId: ["Mi1"],
      secondInstanceId: ["Mi2"],
      firstFaceId: ["JFC"],
      secondFaceId: ["JFD"],
    });
    expect(() =>
      parametersFromDraft("create_mate", {
        mateType: "PIN",
        firstInstanceId: "Mi1",
        secondInstanceId: "Mi2",
        firstFaceId: "JFC",
        secondFaceId: "JFD",
      }),
    ).toThrow(/FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL/i);
  });

  it("requires picks on the draft path only — empty stored plans still parse", () => {
    expect(parseComposerOps([{ operation: "create_fillet", parameters: {} }])).toEqual([
      { id: "step-1", operation: "create_fillet", parameters: {}, reason: "" },
    ]);
    expect(parseComposerOps([{ operation: "create_chamfer", parameters: { widthMm: 1 } }])).toEqual([
      { id: "step-1", operation: "create_chamfer", parameters: { widthMm: 1 }, reason: "" },
    ]);
    expect(parseComposerOps([{ operation: "create_shell", parameters: { thicknessMm: 2 } }])).toEqual([
      { id: "step-1", operation: "create_shell", parameters: { thicknessMm: 2 }, reason: "" },
    ]);
    expect(parseComposerOps([{ operation: "create_hole", parameters: { diameterMm: 5 } }])).toEqual([
      { id: "step-1", operation: "create_hole", parameters: { diameterMm: 5 }, reason: "" },
    ]);
    expect(() => requireComposerPicks("create_fillet", { radiusMm: 2 })).toThrow(/edge id/i);
    expect(requireComposerPicks("create_fillet", { radiusMm: 2, edgeIds: ["E1"] })).toEqual({
      radiusMm: 2,
      edgeIds: ["E1"],
    });
    expect(() => requireComposerPicks("create_chamfer", { widthMm: 1 })).toThrow(/edge id/i);
    expect(() => requireComposerPicks("create_shell", { thicknessMm: 2 })).toThrow(/face id to open/i);
    expect(() => requireComposerPicks("create_hole", { diameterMm: 5, faceIds: ["F2"] })).toThrow(
      /face ids and scope body ids/i,
    );
    expect(() => requireComposerPicks("create_pattern", { instanceCount: 3, spacingMm: 20 })).toThrow(/feature ids/i);
    expect(() => requireComposerPicks("create_pattern", { featureIds: ["F1"], patternKind: "circular" })).toThrow(
      /axis ids/i,
    );
    expect(
      requireComposerPicks("create_pattern", { featureIds: ["F1"], instanceCount: 3, spacingMm: 20 }),
    ).toEqual({
      featureIds: ["F1"],
      instanceCount: 3,
      spacingMm: 20,
    });
    expect(() => requireComposerPicks("create_mirror", {})).toThrow(/feature ids/i);
    expect(() => requireComposerPicks("delete_feature", {})).toThrow(/feature id from the Vantage feature tree/i);
    expect(requireComposerPicks("delete_feature", { featureId: "FFillet" })).toEqual({ featureId: "FFillet" });
    expect(requireComposerPicks("delete_feature", { featureId: ["FFillet"] })).toEqual({ featureId: ["FFillet"] });
    expect(parseComposerOps([{ operation: "create_mate", parameters: {} }])).toEqual([
      { id: "step-1", operation: "create_mate", parameters: {}, reason: "" },
    ]);
    expect(
      parseComposerOps([
        {
          operation: "create_mate",
          parameters: { firstInstanceId: "Mi1", secondInstanceId: "Mi2", firstFaceId: "JFC", secondFaceId: "JFD" },
        },
      ]),
    ).toEqual([
      {
        id: "step-1",
        operation: "create_mate",
        parameters: { firstInstanceId: "Mi1", secondInstanceId: "Mi2", firstFaceId: "JFC", secondFaceId: "JFD" },
        reason: "",
      },
    ]);
    expect(() => requireComposerPicks("create_mate", {})).toThrow(/FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL/i);
    expect(() => requireComposerPicks("create_mate", { firstInstanceId: "Mi1" })).toThrow(
      /FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL/i,
    );
    expect(() => requireComposerPicks("create_mate", { mateType: "PIN" })).toThrow(
      /FASTENED, REVOLUTE, SLIDER, or CYLINDRICAL/i,
    );
    expect(() =>
      requireComposerPicks("create_mate", { mateType: "FASTENED", firstFaceId: ["JFC"], secondFaceId: ["JFD"] }),
    ).toThrow(/instance id/i);
    expect(() =>
      requireComposerPicks("create_mate", { mateType: "revolute", firstInstanceId: "Mi1", secondInstanceId: "Mi2" }),
    ).toThrow(/face id/i);
    expect(() =>
      requireComposerPicks("create_mate", {
        mateType: "SLIDER",
        firstInstanceId: ["Mi1"],
        secondInstanceId: ["Mi2"],
      }),
    ).toThrow(/face id/i);
    expect(
      requireComposerPicks("create_mate", {
        mateType: "fastened",
        firstInstanceId: "Mi1",
        secondInstanceId: "Mi2",
        firstFaceId: "JFC",
        secondFaceId: "JFD",
      }),
    ).toEqual({
      mateType: "FASTENED",
      firstInstanceId: "Mi1",
      secondInstanceId: "Mi2",
      firstFaceId: "JFC",
      secondFaceId: "JFD",
    });
    expect(
      requireComposerPicks("create_mate", {
        mateType: "CYLINDRICAL",
        firstInstanceId: ["Mi1"],
        secondInstanceId: ["Mi2"],
        firstFaceId: ["JFC"],
        secondFaceId: ["JFD"],
      }),
    ).toEqual({
      mateType: "CYLINDRICAL",
      firstInstanceId: ["Mi1"],
      secondInstanceId: ["Mi2"],
      firstFaceId: ["JFC"],
      secondFaceId: ["JFD"],
    });
  });

  it("maps stored shell entities to faceIds", () => {
    expect(parseComposerOps([{ operation: "create_shell", parameters: { thickness: 2, entities: "F1" } }])).toEqual([
      { id: "step-1", operation: "create_shell", parameters: { thicknessMm: 2, faceIds: ["F1"] }, reason: "" },
    ]);
  });

  it("edits and deletes an existing planned step", () => {
    let plan = parseComposerOps([
      { operation: "create_sketch", parameters: { widthMm: 10, heightMm: 10 }, reason: "Stock" },
      { operation: "create_extrude", parameters: { depthMm: 6 }, reason: "Solid" },
    ]);
    plan = replaceComposerOp(plan, "step-2", {
      operation: "create_extrude",
      parameters: { depthMm: 12 },
      reason: "Thicker solid",
    });
    expect(serializeComposerOps(plan)[1]).toEqual({
      operation: "create_extrude",
      parameters: { depthMm: 12 },
      reason: "Thicker solid",
    });
    plan = removeComposerOp(plan, "step-1");
    expect(plan.map((step) => step.operation)).toEqual(["create_extrude"]);
    plan = appendComposerOp(plan, {
      operation: "verify_topology",
      parameters: {},
      reason: "Check bodies",
    });
    expect(plan.map((step) => step.operation)).toEqual(["create_extrude", "verify_topology"]);
  });

  it("exposes export_stl, export_gltf, and render_views like export_step on Onshape only", () => {
    expect(describeComposerOp("export_stl")).toBe("Export STL");
    expect(describeComposerOp("export_gltf")).toBe("Export glTF");
    expect(describeComposerOp("render_views")).toBe("Render views");
    expect(COMPOSER_OP_FIELDS.export_step).toEqual([]);
    expect(COMPOSER_OP_FIELDS.export_stl).toEqual([]);
    expect(COMPOSER_OP_FIELDS.export_gltf).toEqual([]);
    expect(COMPOSER_OP_FIELDS.render_views).toEqual([]);
    expect(emptyComposerParameters("export_stl")).toEqual({});
    expect(emptyComposerParameters("export_gltf")).toEqual({});
    expect(emptyComposerParameters("render_views")).toEqual({});
    expect(parseComposerOps([{ operation: "export_stl", parameters: {} }])).toEqual([
      { id: "step-1", operation: "export_stl", parameters: {}, reason: "" },
    ]);
    expect(parseComposerOps([{ operation: "export_gltf", parameters: {} }])).toEqual([
      { id: "step-1", operation: "export_gltf", parameters: {}, reason: "" },
    ]);
    expect(parseComposerOps([{ operation: "render_views", parameters: {} }])).toEqual([
      { id: "step-1", operation: "render_views", parameters: {}, reason: "" },
    ]);
    expect(parametersFromDraft("export_step", {})).toEqual({});
    expect(parametersFromDraft("export_stl", {})).toEqual({});
    expect(parametersFromDraft("export_gltf", {})).toEqual({});
    expect(parametersFromDraft("render_views", {})).toEqual({});
    expect(requireComposerDimensions("export_stl", {})).toEqual({});
    expect(requireComposerPicks("export_stl", {})).toEqual({});
    expect(requireComposerDimensions("export_gltf", {})).toEqual({});
    expect(requireComposerPicks("export_gltf", {})).toEqual({});
    expect(requireComposerDimensions("render_views", {})).toEqual({});
    expect(requireComposerPicks("render_views", {})).toEqual({});
  });

  it("accepts measured polyline points and refuses invented or incomplete ones", () => {
    expect(
      parametersFromDraft("create_sketch", {
        sketchKind: "polyline",
        points: "0,0; 80,0; 80,40; 0,40",
        closed: true,
      }),
    ).toEqual({
      sketchKind: "polyline",
      points: [
        { xMm: 0, yMm: 0 },
        { xMm: 80, yMm: 0 },
        { xMm: 80, yMm: 40 },
        { xMm: 0, yMm: 40 },
      ],
      closed: true,
    });
    expect(() => parametersFromDraft("create_sketch", { sketchKind: "polyline" })).toThrow(
      /at least two millimetre points/,
    );
    expect(() => parametersFromDraft("create_sketch", { sketchKind: "polyline", points: "0,0" })).toThrow(
      /at least two millimetre points/,
    );
    expect(parseComposerOps([{ operation: "create_sketch", parameters: { sketchKind: "polyline" } }])).toEqual([
      { id: "step-1", operation: "create_sketch", parameters: { sketchKind: "polyline" }, reason: "" },
    ]);
  });

  it("requires real axis and body ids for revolve and boolean drafts", () => {
    expect(describeComposerOp("create_revolve")).toBe("Revolve");
    expect(describeComposerOp("create_boolean")).toBe("Boolean");
    expect(() => parametersFromDraft("create_revolve", {})).toThrow(/axis id/i);
    expect(
      parametersFromDraft("create_revolve", { axisIds: "JHD", angleDeg: "180" }),
    ).toEqual({ axisIds: ["JHD"], angleDeg: 180 });
    expect(() => parametersFromDraft("create_boolean", { operationType: "UNION" })).toThrow(/tool body/i);
    expect(() =>
      parametersFromDraft("create_boolean", { operationType: "SUBTRACT", toolBodyIds: "B1" }),
    ).toThrow(/target body/i);
    expect(
      parametersFromDraft("create_boolean", {
        operationType: "subtract",
        toolBodyIds: "B2",
        targetBodyIds: "B1",
      }),
    ).toEqual({ operationType: "SUBTRACT", toolBodyIds: ["B2"], targetBodyIds: ["B1"] });
  });
});
