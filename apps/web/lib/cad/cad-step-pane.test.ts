import { describe, expect, it } from "vitest";
import { cadStepPaneCopy, classifyCadStepPane, labelCadStepStatus } from "./cad-step-pane";

describe("cad step pane", () => {
  it("separates Needs setup from an empty bound session", () => {
    expect(classifyCadStepPane({ setupRequired: true, bound: false, stepCount: 0 })).toBe("setup");
    expect(classifyCadStepPane({ setupRequired: false, bound: false, stepCount: 0 })).toBe("hidden");
    expect(classifyCadStepPane({ setupRequired: false, bound: true, stepCount: 0 })).toBe("empty");
    expect(classifyCadStepPane({ setupRequired: false, bound: true, stepCount: 3 })).toBe("ready");
    expect(cadStepPaneCopy("setup").badge).toBe("Needs setup");
    expect(labelCadStepStatus("failed")).toBe("Error");
    expect(labelCadStepStatus("done")).toBe("Done");
    expect(labelCadStepStatus("setup_required")).toBe("Needs setup");
  });
});
