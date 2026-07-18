import { describe, expect, it } from "vitest";
import {
  AI_GOVERNANCE_RELATED_INCLUDE,
  AI_GOVERNANCE_SCOPE_CARDS,
  aiGovernanceNextActions,
  aiGovernanceRelatedLinks,
  aiGovernanceShellCopy,
  classifyAiGovernanceShell,
  formatAiGovernanceCount,
  formatAiGovernanceMoney,
  isAiGovernanceIncompleteSetup,
  isAiGovernanceLaissezFaire,
  type AiGovernancePolicySnapshot,
} from "./ai-governance-related";

const laissez: AiGovernancePolicySnapshot = {
  featureAllowlistEnabled: false,
  allowedFeaturesCount: 0,
  toolAllowlistEnabled: false,
  allowedToolsCount: 0,
  requireApprovalAboveThreshold: false,
  highCostThresholdSet: false,
  requireApprovalForFeaturesCount: 0,
  financeInAiEnabled: false,
  dailySpendAlertSet: false,
  monthlySpendAlertSet: false,
  pendingApprovals: 0,
};

describe("aiGovernanceRelatedLinks", () => {
  it("returns empty without org", () => {
    expect(aiGovernanceRelatedLinks()).toEqual([]);
  });

  it("surfaces Chat, Budgets, and Memory with hub query params", () => {
    const links = aiGovernanceRelatedLinks("org-1", {
      include: [...AI_GOVERNANCE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["chat", "budgets", "memory", "finance"]);
    expect(links.find((l) => l.id === "chat")?.href).toContain("/ai?");
    expect(links.find((l) => l.id === "chat")?.href).toContain("tab=chat");
    expect(links.find((l) => l.id === "chat")?.href).toContain("orgId=org-1");
    expect(links.find((l) => l.id === "budgets")?.href).toContain("tab=budgets");
    expect(links.find((l) => l.id === "memory")?.href).toContain("tab=memory");
  });

  it("never uses DEMO labels", () => {
    const blob = JSON.stringify(aiGovernanceRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("classifyAiGovernanceShell + copy", () => {
  it("classifies empty, setup, ready, and forbidden", () => {
    expect(
      classifyAiGovernanceShell({ loading: false, policy: laissez }),
    ).toBe("empty");
    expect(
      classifyAiGovernanceShell({
        loading: false,
        policy: {
          ...laissez,
          featureAllowlistEnabled: true,
          allowedFeaturesCount: 0,
        },
      }),
    ).toBe("setup");
    expect(
      classifyAiGovernanceShell({
        loading: false,
        policy: {
          ...laissez,
          featureAllowlistEnabled: true,
          allowedFeaturesCount: 2,
        },
      }),
    ).toBe("ready");
    expect(
      classifyAiGovernanceShell({
        loading: false,
        status: 403,
        policy: laissez,
      }),
    ).toBe("forbidden");
    expect(
      classifyAiGovernanceShell({
        loading: false,
        error: "Organization administrator access required",
        policy: null,
      }),
    ).toBe("forbidden");
  });

  it("detects incomplete high-cost approval setup", () => {
    expect(
      isAiGovernanceIncompleteSetup({
        ...laissez,
        requireApprovalAboveThreshold: true,
        highCostThresholdSet: false,
      }),
    ).toBe(true);
    expect(isAiGovernanceLaissezFaire(laissez)).toBe(true);
  });

  it("refuses invented DEMO policy stats in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "forbidden", "ready"] as const) {
      const copy = aiGovernanceShellCopy(kind);
      expect(copy.description).toMatch(/never|not|admin|Budgets|Memory/i);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(aiGovernanceShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(aiGovernanceShellCopy("setup").description).toMatch(/DEMO/i);
  });
});

describe("aiGovernanceNextActions", () => {
  it("asks for workspace when org is missing", () => {
    const actions = aiGovernanceNextActions({ shell: "empty" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty at configure + Chat/Budgets/Memory", () => {
    const actions = aiGovernanceNextActions({ orgId: "org-1", shell: "empty" });
    expect(actions[0]?.id).toBe("configure");
    expect(actions.some((a) => a.id === "chat")).toBe(true);
    expect(actions.some((a) => a.id === "budgets")).toBe(true);
    expect(actions.some((a) => a.id === "memory")).toBe(true);
    expect(actions.find((a) => a.id === "chat")?.href).toContain("tab=chat");
    expect(actions.find((a) => a.id === "memory")?.href).toContain("tab=memory");
  });

  it("points setup at finish policy", () => {
    const actions = aiGovernanceNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("finish");
    expect(actions[0]?.href).toBe("#ai-governance-policy");
  });

  it("points forbidden members at Chat / Budgets / Memory", () => {
    const actions = aiGovernanceNextActions({ orgId: "org-1", shell: "forbidden" });
    expect(actions[0]?.id).toBe("chat");
    expect(actions.some((a) => a.id === "budgets")).toBe(true);
    expect(actions.some((a) => a.id === "memory")).toBe(true);
  });
});

describe("formatAiGovernanceMoney + scope cards", () => {
  it("formats only real spend", () => {
    expect(formatAiGovernanceMoney(null, false)).toBe("…");
    expect(formatAiGovernanceMoney("12.5", true)).toBe("$12.50");
    expect(formatAiGovernanceMoney(-3, true)).toBe("$0.00");
    expect(formatAiGovernanceCount("4", true)).toBe("4");
    expect(formatAiGovernanceCount(null, false)).toBe("…");
  });

  it("clarifies ownership without DEMO", () => {
    expect(AI_GOVERNANCE_SCOPE_CARDS.map((c) => c.id)).toEqual([
      "policy",
      "budgets",
      "memory",
      "chat",
    ]);
    expect(JSON.stringify(AI_GOVERNANCE_SCOPE_CARDS)).not.toMatch(/DEMO/i);
  });
});
