import { describe, expect, it } from "vitest";
import type { CadAction } from "../src/agent-policy";
import {
  applyDrawingDimensionsToCast,
  createDrawingAction,
  drawingDimensionsFromBrief,
  drawingDimensionsFromParameters,
  ensureDrawingFirstPlan,
} from "../src/drawing-first";

function step(operation: CadAction["operation"], parameters: Record<string, unknown> = {}): CadAction {
  return { operation, parameters, requiresApproval: true, reason: operation };
}

describe("drawing-first CAD", () => {
  it("copies a parseable envelope and refuses missing or garbage sizes", () => {
    expect(
      drawingDimensionsFromBrief({
        summary: "plate",
        assumptions: [{ name: "Envelope dimensions", value: "80 mm", needsConfirmation: false }],
      }),
    ).toEqual({ widthMm: 80, heightMm: 80, depthMm: 80 });
    expect(drawingDimensionsFromBrief({ summary: "plate", assumptions: [] })).toEqual({});
    expect(
      drawingDimensionsFromBrief({
        summary: "plate",
        assumptions: [{ name: "Envelope dimensions", value: "ask later", needsConfirmation: true }],
      }),
    ).toEqual({});
  });

  it("keeps only finite positive millimetres from a drawing table", () => {
    expect(drawingDimensionsFromParameters({ widthMm: 80, heightMm: 0, depthMm: "40" })).toEqual({
      widthMm: 80,
      depthMm: 40,
    });
    expect(drawingDimensionsFromParameters({ widthMm: "confirmed envelope" })).toEqual({});
  });

  it("prepends create_drawing before sketch/extrude and copies those millimetres", () => {
    const plan = ensureDrawingFirstPlan([
      step("create_sketch", { plane: "Top", widthMm: 80, heightMm: 40 }),
      step("create_extrude", { depthMm: 12 }),
    ]);
    expect(plan.filter((item) => item.operation === "create_drawing").length).toBeGreaterThanOrEqual(1);
    expect(plan.map((item) => item.operation).slice(-2)).toEqual(["create_sketch", "create_extrude"]);
    expect(plan[0]?.operation).toBe("create_drawing");
    expect(plan[0]?.parameters).toMatchObject({ widthMm: 80, heightMm: 40, depthMm: 12 });
    expect(Array.isArray(plan[0]?.parameters.views)).toBe(true);
    expect(Array.isArray(plan[0]?.parameters.notes)).toBe(true);
    const cast = applyDrawingDimensionsToCast([
      createDrawingAction({ widthMm: 80, heightMm: 40, depthMm: 12 }),
      step("create_sketch", { plane: "Top" }),
      step("create_extrude", {}),
    ]);
    expect(cast.find((item) => item.operation === "create_sketch")?.parameters).toMatchObject({
      widthMm: 80,
      heightMm: 40,
    });
    expect(cast.find((item) => item.operation === "create_extrude")?.parameters).toMatchObject({ depthMm: 12 });
  });

  it("does not invent millimetres when the drawing has no sizes", () => {
    const plan = applyDrawingDimensionsToCast(
      ensureDrawingFirstPlan([step("create_sketch", { plane: "Top" }), step("create_extrude", {})]),
    );
    expect(plan[0]?.operation).toBe("create_drawing");
    expect(plan[0]?.parameters).not.toHaveProperty("widthMm");
    expect(plan.find((item) => item.operation === "create_sketch")?.parameters).not.toHaveProperty("widthMm");
    expect(plan.find((item) => item.operation === "create_extrude")?.parameters).not.toHaveProperty("depthMm");
  });

  it("does not prepend a second drawing when one already leads the plan", () => {
    const existing = createDrawingAction({ widthMm: 25 });
    const plan = ensureDrawingFirstPlan([existing, step("create_sketch", { widthMm: 25, heightMm: 25 })]);
    expect(plan.filter((item) => item.operation === "create_drawing")).toHaveLength(1);
    expect(plan[0]).toEqual(existing);
  });
});
