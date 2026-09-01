import { describe, expect, it, vi } from "vitest";
import { parseComposerOps, type ComposerOp } from "./composer-ops";
import {
  COMPOSER_PLAN_FEATURE_SCRIPT,
  parametersForExecute,
  rememberLastSketchFeatureId,
  runComposerPlan,
  type ComposerPlanExecutor,
} from "./run-composer-plan";

function recordingExecutor(
  impl?: ComposerPlanExecutor,
): { execute: ComposerPlanExecutor; calls: ComposerOp[] } {
  const calls: ComposerOp[] = [];
  return {
    calls,
    execute: async (step) => {
      calls.push(step);
      return impl ? impl(step) : {};
    },
  };
}

describe("runComposerPlan", () => {
  it("makes no execute calls for an empty plan", async () => {
    const execute = vi.fn();
    const emptyInputs = [undefined, null, "", "[]", [], { steps: [] }, { ops: [] }, { plan: [] }];

    for (const plan of emptyInputs) {
      const result = await runComposerPlan(plan, execute);
      expect(result).toEqual({ ok: true, completed: 0, steps: [] });
    }

    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects feature_script before any execute call", async () => {
    const execute = vi.fn();
    const plans = [
      [{ operation: "feature_script", parameters: { source: "opExtrude" }, reason: "escape" }],
      {
        steps: [
          { operation: "create_sketch", parameters: { widthMm: 80, heightMm: 40 } },
          { operation: "feature_script", parameters: { source: "opExtrude" } },
          { operation: "create_extrude", parameters: { depthMm: 6 } },
        ],
      },
      JSON.stringify([{ operation: "feature_script", parameters: {} }]),
    ];

    for (const plan of plans) {
      execute.mockClear();
      const result = await runComposerPlan(plan, execute);
      expect(result).toEqual({
        ok: false,
        completed: 0,
        steps: [],
        error: COMPOSER_PLAN_FEATURE_SCRIPT,
      });
      expect(execute).not.toHaveBeenCalled();
    }
  });

  it("walks sketch then extrude then verify in plan order", async () => {
    const { execute, calls } = recordingExecutor(async (step) => {
      if (step.operation === "create_sketch") return { featureId: "Fsketch-real" };
      if (step.operation === "create_extrude") return { featureId: "Fextrude-real" };
      return {};
    });

    const plan = parseComposerOps([
      { operation: "create_sketch", parameters: { widthMm: 80, heightMm: 40, plane: "Top" }, reason: "Stock" },
      { operation: "create_extrude", parameters: { depthMm: 6 }, reason: "Solid" },
      { operation: "verify_topology", parameters: { views: ["iso"] }, reason: "Check bodies" },
    ]);

    const result = await runComposerPlan(plan, execute);

    expect(calls.map((step) => step.operation)).toEqual([
      "create_sketch",
      "create_extrude",
      "verify_topology",
    ]);
    expect(calls[1]?.parameters.sketchFeatureId).toBe("Fsketch-real");
    expect(result).toEqual({
      ok: true,
      completed: 3,
      steps: [
        { id: "step-1", operation: "create_sketch", status: "completed", featureId: "Fsketch-real" },
        { id: "step-2", operation: "create_extrude", status: "completed", featureId: "Fextrude-real" },
        { id: "step-3", operation: "verify_topology", status: "completed" },
      ],
    });
  });

  it("stops on the first failure and does not run later steps", async () => {
    const { execute, calls } = recordingExecutor(async (step) => {
      if (step.operation === "create_sketch") return { featureId: "Fsketch-real" };
      throw new Error("Onshape rejected the extrude");
    });

    const result = await runComposerPlan(
      [
        { operation: "create_sketch", parameters: { widthMm: 10, heightMm: 10 } },
        { operation: "create_extrude", parameters: { depthMm: 6 } },
        { operation: "verify_topology", parameters: {} },
      ],
      execute,
    );

    expect(calls.map((step) => step.operation)).toEqual(["create_sketch", "create_extrude"]);
    expect(result.ok).toBe(false);
    expect(result.completed).toBe(1);
    expect(result.error).toBe("Onshape rejected the extrude");
    expect(result.steps).toEqual([
      { id: "step-1", operation: "create_sketch", status: "completed", featureId: "Fsketch-real" },
      { id: "step-2", operation: "create_extrude", status: "failed", error: "Onshape rejected the extrude" },
    ]);
  });

  it("never invents a sketchFeatureId when the sketch returned none", async () => {
    const { execute, calls } = recordingExecutor(async () => ({}));

    const result = await runComposerPlan(
      [
        { operation: "create_sketch", parameters: { widthMm: 80, heightMm: 40 } },
        { operation: "create_extrude", parameters: { depthMm: 6 } },
      ],
      execute,
    );

    expect(result.ok).toBe(true);
    expect(calls[1]?.parameters.sketchFeatureId).toBeUndefined();
    expect(JSON.stringify(calls)).not.toMatch(/demo/i);
    expect(calls[1]?.parameters).not.toHaveProperty("sketchFeatureId");
    expect(result.steps.every((step) => step.featureId == null)).toBe(true);
  });

  it("does not treat DEMO or blank execute ids as real feature ids", async () => {
    const { execute, calls } = recordingExecutor(async (step) => {
      if (step.operation === "create_sketch") return { featureId: "DEMO-plate" };
      return { externalFeatureId: "  " };
    });

    const result = await runComposerPlan(
      [
        { operation: "create_sketch", parameters: { widthMm: 80, heightMm: 40 } },
        { operation: "create_extrude", parameters: { depthMm: 4 } },
      ],
      execute,
    );

    expect(calls[1]?.parameters.sketchFeatureId).toBeUndefined();
    expect(result.steps.map((step) => step.featureId)).toEqual([undefined, undefined]);
  });

  it("keeps a human-planned sketchFeatureId and does not invent another", async () => {
    const { execute, calls } = recordingExecutor(async (step) => {
      if (step.operation === "create_sketch") return { featureId: "Ffrom-sketch" };
      return {};
    });

    await runComposerPlan(
      [
        { operation: "create_sketch", parameters: { widthMm: 20, heightMm: 20 } },
        {
          operation: "create_extrude",
          parameters: { depthMm: 8, sketchFeatureId: "Fhuman-typed" },
        },
      ],
      execute,
    );

    expect(calls[1]?.parameters.sketchFeatureId).toBe("Fhuman-typed");
  });

  it("walks ops in the given order and does not reorder to sketch-first", async () => {
    const { execute, calls } = recordingExecutor();

    await runComposerPlan(
      [
        { operation: "verify_topology", parameters: {} },
        { operation: "create_sketch", parameters: { widthMm: 12, heightMm: 8 } },
      ],
      execute,
    );

    expect(calls.map((step) => step.operation)).toEqual(["verify_topology", "create_sketch"]);
  });

  it("fails a Run-plan create_extrude without depthMm before execute", async () => {
    const execute = vi.fn();
    const result = await runComposerPlan(
      [{ operation: "create_extrude", parameters: {}, reason: "Solid" }],
      execute,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.completed).toBe(0);
    expect(result.error).toBe("Extrude depth is required millimetres.");
    expect(result.steps).toEqual([
      {
        id: "step-1",
        operation: "create_extrude",
        status: "failed",
        error: "Extrude depth is required millimetres.",
      },
    ]);
  });
});

describe("parametersForExecute", () => {
  it("fills sketchFeatureId from a prior real sketch id", () => {
    const extrude: ComposerOp = {
      id: "step-2",
      operation: "create_extrude",
      parameters: { depthMm: 6 },
      reason: "Solid",
    };

    expect(parametersForExecute(extrude, "Fsketch-real").sketchFeatureId).toBe("Fsketch-real");
    expect(parametersForExecute(extrude, undefined)).toEqual({ depthMm: 6 });
    expect(
      parametersForExecute(
        { ...extrude, parameters: { depthMm: 8, sketchFeatureId: "Fhuman-typed" } },
        "Fsketch-real",
      ).sketchFeatureId,
    ).toBe("Fhuman-typed");
    expect(
      parametersForExecute(
        { ...extrude, parameters: { depthMm: 8, sketchFeatureId: ["Fpicked"] } },
        "Fsketch-real",
      ).sketchFeatureId,
    ).toBe("Fpicked");
  });
});

describe("rememberLastSketchFeatureId", () => {
  it("keeps a real create_sketch id and refuses DEMO", () => {
    expect(rememberLastSketchFeatureId("create_sketch", "Fsketch-real", undefined)).toBe("Fsketch-real");
    expect(rememberLastSketchFeatureId("create_sketch", "DEMO-plate", undefined)).toBeUndefined();
    expect(rememberLastSketchFeatureId("create_sketch", "DEMO-plate", "Fkeep")).toBe("Fkeep");
    expect(rememberLastSketchFeatureId("create_sketch", "  ", "Fkeep")).toBe("Fkeep");
    expect(rememberLastSketchFeatureId("create_extrude", "Fextrude-real", "Fkeep")).toBe("Fkeep");
  });
});
