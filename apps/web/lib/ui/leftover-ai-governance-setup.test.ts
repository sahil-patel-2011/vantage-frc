import { describe, expect, it } from "vitest";
import { aiGovernanceShellCopy } from "../ai-governance/ai-governance-related";

describe("leftover AI Governance setup chrome", () => {
  it("incomplete policy is Needs setup, not Setup", () => {
    expect(aiGovernanceShellCopy("setup").badge).toBe("Needs setup");
    expect(aiGovernanceShellCopy("setup").title).toBe("Finish the policy you started");
    expect(aiGovernanceShellCopy("empty").badge).toBe("Defaults");
  });
});
