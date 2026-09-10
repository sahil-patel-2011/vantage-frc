import { describe, expect, it } from "vitest";
import {
  DECISIONS_RELATED_INCLUDE,
  classifyDecisionsShell,
  decisionsNextActions,
  decisionsRelatedLinks,
  decisionsShellCopy,
  formatDecisionsMetric,
} from "./decisions-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("decisionsRelatedLinks", () => {
  it("builds Decision Search / Season Report / Knowledge cross-links", () => {
    const links = decisionsRelatedLinks("org-1", { include: [...DECISIONS_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["decision-search", "season-report", "knowledge"]);
    expect(links.find((l) => l.id === "decision-search")?.href).toBe(
      "/ai?tab=decision-search&orgId=org-1",
    );
    expect(links.find((l) => l.id === "season-report")?.href).toBe(
      "/ai?tab=season-report&orgId=org-1",
    );
    expect(links.find((l) => l.id === "knowledge")?.href).toBe("/team?tab=knowledge&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = decisionsRelatedLinks("org-1", {
      active: "knowledge",
      include: ["decision-search", "season-report"],
    });
    expect(links.map((l) => l.id)).toEqual(["decision-search", "season-report"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(decisionsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("decisionsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = decisionsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "decision-search")).toBe(true);
    expect(actions.some((a) => a.id === "season-report")).toBe(true);
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
  });

  it("setup with org points at Workspace + Decision Search / Season Report / Knowledge", () => {
    const actions = decisionsNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "decision-search")).toBe(true);
    expect(actions.some((a) => a.id === "season-report")).toBe(true);
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at record + Decision Search / Season Report / Knowledge", () => {
    const actions = decisionsNextActions({
      orgId: "org-1",
      shell: "empty",
      decisionCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["record", "decision-search", "season-report", "knowledge"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize Decision Search / Season Report / Knowledge without DEMO entries", () => {
    const actions = decisionsNextActions({
      orgId: "org-1",
      shell: "ready",
      decisionCount: 4,
      openCount: 0,
    });
    expect(actions.some((a) => a.id === "decision-search")).toBe(true);
    expect(actions.some((a) => a.id === "season-report")).toBe(true);
    expect(actions.some((a) => a.id === "knowledge")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });

  it("surfaces open proposals when present", () => {
    const actions = decisionsNextActions({
      orgId: "org-1",
      shell: "ready",
      decisionCount: 3,
      openCount: 2,
    });
    expect(actions[0]?.id).toBe("resolve");
    expect(actions[0]?.href).toBe("#decision-log-open");
  });
});

describe("classifyDecisionsShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO entries", () => {
    expect(classifyDecisionsShell({ loading: true })).toBe("loading");
    expect(classifyDecisionsShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyDecisionsShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyDecisionsShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyDecisionsShell({
        loading: false,
        orgId: "o1",
        status: "live",
        decisionCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyDecisionsShell({
        loading: false,
        orgId: "o1",
        status: "live",
        decisionCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("decisionsShellCopy + formatDecisionsMetric", () => {
  it("refuses invented DEMO log entries in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = decisionsShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(decisionsShellCopy("empty").description);
    expectPlainCopy(decisionsShellCopy("setup").description);
  });

  it("formats real counts only", () => {
    expect(formatDecisionsMetric(null, false)).toBe("…");
    expect(formatDecisionsMetric(3, true)).toBe("3");
    expect(formatDecisionsMetric(-1, true)).toBe("0");
  });
});
