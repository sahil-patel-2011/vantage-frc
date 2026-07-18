import { describe, expect, it } from "vitest";
import {
  DEFAULT_ORG_AI_POLICY,
  isFeatureAllowed,
  isToolAllowed,
  needsAiApproval,
  normalizeStringList,
  normalizeThresholds,
} from "../src/ai-governance";

describe("AI governance policy evaluation", () => {
  it("allows all features when allowlist is disabled", () => {
    expect(isFeatureAllowed(DEFAULT_ORG_AI_POLICY, "research")).toBe(true);
  });

  it("enforces feature allowlist when enabled", () => {
    const policy = {
      ...DEFAULT_ORG_AI_POLICY,
      featureAllowlistEnabled: true,
      allowedFeatures: ["chat", "strategy"],
    };
    expect(isFeatureAllowed(policy, "chat")).toBe(true);
    expect(isFeatureAllowed(policy, "research")).toBe(false);
  });

  it("enforces tool allowlist with wildcard", () => {
    const policy = {
      ...DEFAULT_ORG_AI_POLICY,
      toolAllowlistEnabled: true,
      allowedTools: ["scouting.team"],
    };
    expect(isToolAllowed(policy, "scouting.team")).toBe(true);
    expect(isToolAllowed(policy, "strategy.match")).toBe(false);
    expect(isToolAllowed({ ...policy, allowedTools: ["*"] }, "strategy.match")).toBe(true);
  });

  it("requires approval for listed features and cost thresholds", () => {
    const policy = {
      ...DEFAULT_ORG_AI_POLICY,
      requireApprovalForFeatures: ["cad"],
      requireApprovalAboveThreshold: true,
      highCostThresholdUsd: 1,
      adminBypassApproval: true,
    };
    expect(
      needsAiApproval(policy, { feature: "cad", estimatedCostUsd: 0.01, isOrgAdmin: false }),
    ).toEqual({ required: true, reason: "feature.requires_approval" });
    expect(
      needsAiApproval(policy, { feature: "chat", estimatedCostUsd: 1.5, isOrgAdmin: false }),
    ).toEqual({ required: true, reason: "cost.above_threshold" });
    expect(
      needsAiApproval(policy, { feature: "cad", estimatedCostUsd: 2, isOrgAdmin: true }),
    ).toEqual({ required: false, reason: null });
  });

  it("normalizes lists and thresholds", () => {
    expect(normalizeStringList([" Chat ", "chat", "", "STRATEGY"])).toEqual(["chat", "strategy"]);
    expect(normalizeThresholds([90, 50, 50, 120, 0])).toEqual([50, 90]);
  });
});
