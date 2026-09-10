import { describe, expect, it } from "vitest";
import {
  RULE_IMPACT_RELATED_INCLUDE,
  classifyRuleImpactShell,
  formatRuleImpactConfidencePct,
  formatRuleImpactMetric,
  ruleImpactNextActions,
  ruleImpactRelatedLinks,
  ruleImpactShellCopy,
} from "./rule-impact-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("ruleImpactRelatedLinks", () => {
  it("builds Kickoff / CAD / Subsystems cross-links", () => {
    const links = ruleImpactRelatedLinks("org-1", {
      include: [...RULE_IMPACT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["kickoff", "cad", "subsystems"]);
    expect(links.find((l) => l.id === "kickoff")?.href).toBe("/build?tab=kickoff&orgId=org-1");
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
    expect(links.find((l) => l.id === "subsystems")?.href).toBe("/subsystems?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = ruleImpactRelatedLinks("org-1", {
      active: "cad",
      include: ["kickoff", "subsystems"],
    });
    expect(links.map((l) => l.id)).toEqual(["kickoff", "subsystems"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(ruleImpactRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("ruleImpactNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = ruleImpactNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
  });

  it("setup with org points at Workspace + Kickoff / CAD / Subsystems", () => {
    const actions = ruleImpactNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log-rule + Kickoff / CAD / Subsystems", () => {
    const actions = ruleImpactNextActions({
      orgId: "org-1",
      shell: "empty",
      ruleChangeCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log-rule", "kickoff", "cad", "subsystems"]),
    );
    expect(actions[0]?.href).toBe("#rule-impact-log-change");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize triage without DEMO metrics", () => {
    const actions = ruleImpactNextActions({
      orgId: "org-1",
      shell: "ready",
      ruleChangeCount: 2,
      candidateCount: 3,
      blockedCount: 1,
      openAssessmentCount: 0,
    });
    expect(actions[0]?.id).toBe("assess-blocked");
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyRuleImpactShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyRuleImpactShell({ loading: true })).toBe("loading");
    expect(classifyRuleImpactShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyRuleImpactShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyRuleImpactShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyRuleImpactShell({
        loading: false,
        orgId: "o1",
        status: "live",
        ruleChangeCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyRuleImpactShell({
        loading: false,
        orgId: "o1",
        status: "live",
        ruleChangeCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("ruleImpactShellCopy + format helpers", () => {
  it("refuses invented DEMO impact metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = ruleImpactShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(ruleImpactShellCopy("empty").description);
    expectPlainCopy(ruleImpactShellCopy("setup").description);
  });

  it("formats real counts and blanks confidence until a signal exists", () => {
    expect(formatRuleImpactMetric(null, false)).toBe("…");
    expect(formatRuleImpactMetric(3, true)).toBe("3");
    expect(formatRuleImpactMetric(-1, true)).toBe("0");
    expect(formatRuleImpactConfidencePct(0.42, true, false)).toBe("—");
    expect(formatRuleImpactConfidencePct(0.42, true, true)).toBe("42%");
  });
});
