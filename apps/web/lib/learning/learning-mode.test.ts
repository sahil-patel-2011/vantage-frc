import { describe, expect, it } from "vitest";
import {
  canReadOrgCalls,
  defaultLearningModeEnabled,
  isLearningSurface,
  learningSurfaceLabel,
  parseLearningSurface,
  resolveLearningModeEnabled,
  roleTier,
  shouldGateResult,
} from "./learning-mode";

describe("roleTier", () => {
  it("puts owners and admins in the mentor tier", () => {
    expect(roleTier("owner")).toBe("mentor");
    expect(roleTier("admin")).toBe("mentor");
  });

  it("puts scouts and viewers in the student tier", () => {
    expect(roleTier("scout")).toBe("student");
    expect(roleTier("viewer")).toBe("student");
  });

  it("treats unknown or missing roles as students so the gate fails toward teaching", () => {
    expect(roleTier(null)).toBe("student");
    expect(roleTier(undefined)).toBe("student");
    expect(roleTier("mentor_emeritus")).toBe("student");
  });
});

describe("defaultLearningModeEnabled / resolveLearningModeEnabled", () => {
  it("defaults on for students and off for mentors", () => {
    expect(defaultLearningModeEnabled("scout")).toBe(true);
    expect(defaultLearningModeEnabled("owner")).toBe(false);
  });

  it("lets an explicit stored choice win in both directions", () => {
    expect(resolveLearningModeEnabled("scout", false)).toBe(false);
    expect(resolveLearningModeEnabled("owner", true)).toBe(true);
    expect(resolveLearningModeEnabled("scout", null)).toBe(true);
    expect(resolveLearningModeEnabled("owner", undefined)).toBe(false);
  });
});

describe("shouldGateResult", () => {
  it("never gates a mentor", () => {
    for (const role of ["owner", "admin"]) {
      const decision = shouldGateResult({ role });
      expect(decision.gated).toBe(false);
      expect(decision.reason).toBe("mentor_never_gated");
      expect(decision.tier).toBe("mentor");
    }
  });

  it("gates a student by default", () => {
    const decision = shouldGateResult({ role: "scout" });
    expect(decision.gated).toBe(true);
    expect(decision.reason).toBe("call_required");
  });

  it("opens the gate once the student has answered or skipped", () => {
    const decision = shouldGateResult({ role: "viewer", alreadyAnswered: true });
    expect(decision.gated).toBe(false);
    expect(decision.reason).toBe("already_answered");
  });

  it("opens the gate when the student turns learning mode off", () => {
    const decision = shouldGateResult({ role: "scout", learningModeEnabled: false });
    expect(decision.gated).toBe(false);
    expect(decision.reason).toBe("learning_mode_off");
  });

  it("gates a mentor who deliberately opts in", () => {
    const decision = shouldGateResult({ role: "owner", learningModeEnabled: true });
    expect(decision.gated).toBe(true);
    expect(decision.tier).toBe("mentor");
  });

  it("is always skippable, whatever the decision", () => {
    const inputs = [
      { role: "scout" },
      { role: "owner" },
      { role: "viewer", learningModeEnabled: false },
      { role: "scout", alreadyAnswered: true },
    ];
    for (const input of inputs) {
      const decision = shouldGateResult(input);
      expect(decision.skippable).toBe(true);
      expect(decision.skipLabel).toBe("Just show me");
    }
  });
});

describe("canReadOrgCalls", () => {
  it("only lets mentors read the whole org's ledger", () => {
    expect(canReadOrgCalls("owner")).toBe(true);
    expect(canReadOrgCalls("admin")).toBe(true);
    expect(canReadOrgCalls("scout")).toBe(false);
    expect(canReadOrgCalls(null)).toBe(false);
  });
});

describe("surfaces", () => {
  it("accepts the three gated calculators and rejects anything else", () => {
    expect(isLearningSurface("gearbox")).toBe(true);
    expect(isLearningSurface("power_budget")).toBe(true);
    expect(isLearningSurface("shooter_table")).toBe(true);
    expect(isLearningSurface("cad")).toBe(false);
    expect(() => parseLearningSurface("cad")).toThrow(/surface must be one of/);
    expect(() => parseLearningSurface(null)).toThrow();
  });

  it("labels each surface", () => {
    expect(learningSurfaceLabel("gearbox")).toBe("Gearbox ratio");
    expect(learningSurfaceLabel("shooter_table")).toBe("Shooter table");
  });
});
