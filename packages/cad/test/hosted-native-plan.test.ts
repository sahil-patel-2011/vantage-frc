import { describe, expect, it } from "vitest";
import { cadAiPlanUserMessage, parseCadActionPlan } from "../src/ai-plan";
import { HOSTED_NATIVE, buildDefaultCadPlan } from "../src/agent-policy";

const BRIEF = {
  summary: "intake roller",
  assumptions: [{ name: "Envelope dimensions", value: "12 in", needsConfirmation: false }],
};

describe("hosted native CAD plans", () => {
  it("never emits feature_script from the default hosted plan", () => {
    const variants = [
      buildDefaultCadPlan(BRIEF),
      buildDefaultCadPlan(BRIEF, { autoRunVerify: true }),
      buildDefaultCadPlan(BRIEF, { includeExport: "step" }),
      buildDefaultCadPlan(BRIEF, { includeExport: "stl" }),
      buildDefaultCadPlan(BRIEF, { includeExport: "gltf" }),
    ];
    for (const plan of variants) {
      expect(plan.map((step) => step.operation)).not.toContain("feature_script");
      expect(plan.every((step) => HOSTED_NATIVE.includes(step.operation))).toBe(true);
      expect(plan.some((step) => step.operation === "create_sketch")).toBe(true);
      expect(plan.some((step) => step.operation === "create_extrude")).toBe(true);
    }
  });

  it("does not offer feature_script in the hosted AI planner prompt", () => {
    const message = cadAiPlanUserMessage(BRIEF);
    expect(message).not.toMatch(/feature_script/);
    expect(message).toContain("create_sketch");
    expect(message).toContain("create_extrude");
    expect(message).toContain("create_mate");
    expect(HOSTED_NATIVE).not.toContain("feature_script");
  });

  it("drops feature_script if a hosted model still emits it", () => {
    const plan = parseCadActionPlan(
      '[{"operation":"create_sketch","reason":"profile"},{"operation":"feature_script","parameters":{"source":"opExtrude()"},"reason":"fs"},{"operation":"create_extrude","reason":"solid"}]',
    );
    expect(plan.map((step) => step.operation)).not.toContain("feature_script");
    expect(plan.map((step) => step.operation)).toEqual(["create_sketch", "create_extrude", "verify_topology"]);
  });
});
