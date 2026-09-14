import { describe, expect, it } from "vitest";
import { cadAiPlanUserMessage, parseCadActionPlan } from "../src/ai-plan";
import { HOSTED_NATIVE, buildDefaultCadPlan, parseEnvelopeMm } from "../src/agent-policy";

const BRIEF = {
  summary: "intake roller",
  assumptions: [{ name: "Envelope dimensions", value: "12 in", needsConfirmation: false }],
};

describe("hosted native CAD plans", () => {
  it("allows native create_shell, create_chamfer, and set_variable on the hosted allowlist", () => {
    expect(HOSTED_NATIVE).toContain("create_drawing");
    expect(HOSTED_NATIVE).toContain("create_shell");
    expect(HOSTED_NATIVE).toContain("create_chamfer");
    expect(HOSTED_NATIVE).toContain("set_variable");
    expect(HOSTED_NATIVE).toContain("create_hole");
    expect(HOSTED_NATIVE).toContain("create_mirror");
    expect(HOSTED_NATIVE).toContain("delete_feature");
    expect(HOSTED_NATIVE).toContain("create_revolve");
    expect(HOSTED_NATIVE).toContain("create_boolean");
    expect(HOSTED_NATIVE).not.toContain("feature_script");
  });

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
      expect(plan.some((step) => step.operation === "create_drawing")).toBe(true);
      expect(plan.some((step) => step.operation === "create_sketch")).toBe(true);
      expect(plan.some((step) => step.operation === "create_extrude")).toBe(true);
    }
  });

  it("does not offer feature_script in the hosted AI planner prompt", () => {
    const message = cadAiPlanUserMessage(BRIEF);
    expect(message).not.toMatch(/feature_script/);
    expect(message).toContain("create_drawing");
    expect(message).toContain("create_sketch");
    expect(message).toContain("create_extrude");
    expect(message).toContain("create_mate");
    expect(message).toContain("set_variable");
    expect(HOSTED_NATIVE).not.toContain("feature_script");
  });

  it("drops feature_script if a hosted model still emits it", () => {
    const plan = parseCadActionPlan(
      '[{"operation":"create_sketch","reason":"profile"},{"operation":"feature_script","parameters":{"source":"opExtrude()"},"reason":"fs"},{"operation":"create_extrude","reason":"solid"}]',
    );
    expect(plan.map((step) => step.operation)).not.toContain("feature_script");
    expect(plan.map((step) => step.operation)).toEqual([
      "create_drawing",
      "create_sketch",
      "create_extrude",
      "verify_topology",
    ]);
  });

  it("parseEnvelopeMm converts real lengths and refuses missing or garbage values", () => {
    expect(parseEnvelopeMm("80 mm")).toBe(80);
    expect(parseEnvelopeMm("12 in")).toBe(304.8);
    expect(parseEnvelopeMm(undefined)).toBeUndefined();
    expect(parseEnvelopeMm(null)).toBeUndefined();
    expect(parseEnvelopeMm("")).toBeUndefined();
    expect(parseEnvelopeMm("confirmed envelope")).toBeUndefined();
    expect(parseEnvelopeMm("ask later")).toBeUndefined();
    expect(parseEnvelopeMm("0 mm")).toBeUndefined();
  });

  it("emits widthMm/heightMm/depthMm from a parseable envelope", () => {
    const mmPlan = buildDefaultCadPlan({
      summary: "plate",
      assumptions: [{ name: "Envelope dimensions", value: "80 mm", needsConfirmation: false }],
    });
    const inPlan = buildDefaultCadPlan(BRIEF);
    const mmSketch = mmPlan.find((step) => step.operation === "create_sketch");
    const mmExtrude = mmPlan.find((step) => step.operation === "create_extrude");
    const inSketch = inPlan.find((step) => step.operation === "create_sketch");
    const inExtrude = inPlan.find((step) => step.operation === "create_extrude");
    expect(mmSketch?.parameters).toMatchObject({ plane: "Top", widthMm: 80, heightMm: 80 });
    expect(mmExtrude?.parameters).toMatchObject({ depthMm: 80 });
    expect(inSketch?.parameters).toMatchObject({ plane: "Top", widthMm: 304.8, heightMm: 304.8 });
    expect(inExtrude?.parameters).toMatchObject({ depthMm: 304.8 });
    expect(mmSketch?.parameters).not.toHaveProperty("profile");
    expect(mmExtrude?.parameters).not.toHaveProperty("depth");
    expect(mmSketch?.requiresApproval).toBe(true);
    expect(mmExtrude?.requiresApproval).toBe(true);
  });

  it("does not invent millimetres when the envelope is missing or unparseable", () => {
    const variants = [
      buildDefaultCadPlan({ summary: "plate", assumptions: [] }),
      buildDefaultCadPlan({
        summary: "plate",
        assumptions: [{ name: "Envelope dimensions", value: "ask later", needsConfirmation: true }],
      }),
    ];
    for (const plan of variants) {
      const sketch = plan.find((step) => step.operation === "create_sketch");
      const extrude = plan.find((step) => step.operation === "create_extrude");
      expect(sketch).toBeDefined();
      expect(extrude).toBeDefined();
      expect(sketch?.parameters.plane).toBe("Top");
      expect(sketch?.parameters).not.toHaveProperty("widthMm");
      expect(sketch?.parameters).not.toHaveProperty("heightMm");
      expect(sketch?.parameters).not.toHaveProperty("profile");
      expect(extrude?.parameters).not.toHaveProperty("depthMm");
      expect(extrude?.parameters).not.toHaveProperty("depth");
      expect(JSON.stringify(sketch?.parameters)).not.toMatch(/confirmed envelope/i);
      expect(JSON.stringify(extrude?.parameters)).not.toMatch(/confirmed by user/i);
      expect(sketch?.requiresApproval).toBe(true);
      expect(extrude?.requiresApproval).toBe(true);
    }
  });
});
