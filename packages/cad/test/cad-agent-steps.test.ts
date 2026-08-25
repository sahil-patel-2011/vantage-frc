import { describe, expect, it } from "vitest";
import { cadAgentStep, parseCadAgentSteps, summarizeCadAgentSteps } from "../src/cad-agent-steps";

/**
 * The session pane is only trustworthy if a step says exactly what the tool said.
 * These tests pin that: narration is lifted verbatim, and a failed or refused tool
 * still produces a step rather than vanishing from the log.
 */
describe("cadAgentStep", () => {
  it("lifts the tool's own narration verbatim", () => {
    const step = cadAgentStep({
      index: 1,
      tool: "onshape_hole",
      ok: true,
      result: {
        ok: true,
        featureId: "F-hole",
        narration: { title: "Drilled 4× ⌀5 mm through holes", detail: "at the points of F-points" },
      },
      at: "2026-08-01T10:00:00.000Z",
    });
    expect(step.title).toBe("Drilled 4× ⌀5 mm through holes");
    expect(step.detail).toBe("at the points of F-points");
    expect(step.status).toBe("done");
    expect(step.featureId).toBe("F-hole");
    expect(step.label).toBe("Hole");
  });

  it("falls back to the catalog label when a tool has no narration", () => {
    const step = cadAgentStep({ index: 1, tool: "onshape_list_documents", ok: true, result: { documents: [] } });
    expect(step.title).toBe("List documents");
    expect(step.status).toBe("done");
    expect(step.featureId).toBeNull();
  });

  it("keeps a thrown tool in the log with its real error", () => {
    const step = cadAgentStep({
      index: 2,
      tool: "onshape_fillet",
      ok: false,
      result: { ok: false, error: "Onshape returned no corner edges for feature F-1." },
    });
    expect(step.status).toBe("failed");
    expect(step.title).toBe("Fillet failed");
    expect(step.detail).toContain("no corner edges");
  });

  /** The Fusion "Onshape only" refusal returns ok:false in the body without throwing. */
  it("treats an in-body ok:false as a failed step", () => {
    const step = cadAgentStep({
      index: 3,
      tool: "fusion_undo_last",
      ok: true,
      result: { ok: false, unsupported: true, error: "Fusion undo is Onshape only." },
    });
    expect(step.status).toBe("failed");
    expect(step.detail).toBe("Fusion undo is Onshape only.");
  });

  it("records the deleted feature id for an undo step", () => {
    const step = cadAgentStep({
      index: 4,
      tool: "onshape_delete_feature",
      ok: true,
      result: { ok: true, deletedFeatureId: "F-9", narration: { title: "Deleted VantageFillet (F-9)" } },
    });
    expect(step.featureId).toBe("F-9");
  });

  it("never claims a dimension the tool did not report", () => {
    const step = cadAgentStep({ index: 1, tool: "onshape_extrude", ok: true, result: { ok: true } });
    expect(step.detail).toBe("");
    expect(step.title).toBe("Extrude");
  });
});

describe("parseCadAgentSteps", () => {
  it("drops malformed rows and renumbers what survives", () => {
    const steps = parseCadAgentSteps([
      { tool: "onshape_extrude", title: "Extruded 6 mm (NEW)", status: "done", at: "t" },
      null,
      { tool: "onshape_fillet", status: "done" },
      { title: "no tool", status: "done" },
      { tool: "onshape_hole", title: "Drilled 4 holes", status: "bogus" },
      { tool: "onshape_mirror", title: "Mirrored", status: "failed", at: "t2" },
    ]);
    expect(steps.map((step) => step.index)).toEqual([1, 2]);
    expect(steps[1]?.status).toBe("failed");
  });

  it("returns an empty list for non-array input", () => {
    expect(parseCadAgentSteps(undefined)).toEqual([]);
    expect(parseCadAgentSteps("steps")).toEqual([]);
  });

  it("keeps only the most recent window", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      tool: "onshape_extrude",
      title: `step ${i}`,
      status: "done",
      at: "t",
    }));
    const steps = parseCadAgentSteps(many, 40);
    expect(steps).toHaveLength(40);
    expect(steps[0]?.title).toBe("step 20");
    expect(steps[39]?.index).toBe(40);
  });
});

describe("summarizeCadAgentSteps", () => {
  const step = (status: "done" | "failed") =>
    cadAgentStep({ index: 1, tool: "onshape_extrude", ok: status === "done", result: { ok: status === "done" } });

  it("counts failures separately", () => {
    expect(summarizeCadAgentSteps([step("done"), step("done"), step("failed")])).toBe(
      "2 steps completed, 1 failed.",
    );
  });

  it("is empty when nothing ran", () => {
    expect(summarizeCadAgentSteps([])).toBe("");
  });

  it("uses the singular for one step", () => {
    expect(summarizeCadAgentSteps([step("done")])).toBe("1 step completed.");
  });
});
