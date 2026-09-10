import { describe, expect, it } from "vitest";
import {
  JUDGE_SIM_RELATED_INCLUDE,
  classifyJudgeSimShell,
  formatJudgeSimMetric,
  formatJudgeSimReadiness,
  judgeSimNextActions,
  judgeSimRelatedLinks,
  judgeSimShellCopy,
  shouldShowJudgeSimSummaryTiles,
} from "./judge-sim-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("judgeSimRelatedLinks", () => {
  it("builds Community Impact / Impact Essay / Awards cross-links", () => {
    const links = judgeSimRelatedLinks("org-1", {
      include: [...JUDGE_SIM_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["impact", "impact-essay", "evidence"]);
    expect(links.find((l) => l.id === "impact")?.href).toBe("/business?tab=impact&orgId=org-1");
    expect(links.find((l) => l.id === "impact-essay")?.href).toBe(
      "/business?tab=impact-essay&orgId=org-1",
    );
    expect(links.find((l) => l.id === "evidence")?.href).toBe("/business?tab=evidence&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = judgeSimRelatedLinks("org-1", {
      active: "impact",
      include: ["impact-essay", "award-tracker"],
    });
    expect(links.map((l) => l.id)).toEqual(["impact-essay", "award-tracker"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(judgeSimRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("judgeSimNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = judgeSimNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.some((a) => a.id === "impact-essay")).toBe(true);
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
  });

  it("setup with org points at Workspace + Impact / Essay / Awards", () => {
    const actions = judgeSimNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.some((a) => a.id === "impact-essay")).toBe(true);
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty shells at evidence/session + Impact / Essay / Awards", () => {
    const noEvidence = judgeSimNextActions({
      orgId: "org-1",
      shell: "empty",
      sessionCount: 0,
      evidenceCount: 0,
    });
    expect(noEvidence[0]?.id).toBe("log-evidence");
    expect(noEvidence[0]?.href).toBe("#judge-sim-evidence");
    expect(noEvidence.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log-evidence", "impact", "impact-essay", "evidence"]),
    );

    const withEvidence = judgeSimNextActions({
      orgId: "org-1",
      shell: "empty",
      sessionCount: 0,
      evidenceCount: 2,
    });
    expect(withEvidence[0]?.id).toBe("run-session");
    expect(withEvidence[0]?.href).toBe("#judge-sim-session");
    expect(withEvidence.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready shells prioritize review without DEMO metrics", () => {
    const actions = judgeSimNextActions({
      orgId: "org-1",
      shell: "ready",
      sessionCount: 3,
      evidenceCount: 5,
    });
    expect(actions[0]?.id).toBe("review-sessions");
    expect(actions.some((a) => a.id === "impact")).toBe(true);
    expect(actions.some((a) => a.id === "impact-essay")).toBe(true);
    expect(actions.some((a) => a.id === "evidence")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyJudgeSimShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyJudgeSimShell({ loading: true })).toBe("loading");
    expect(classifyJudgeSimShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyJudgeSimShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe("error");
    expect(
      classifyJudgeSimShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyJudgeSimShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sessionCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyJudgeSimShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sessionCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("judgeSimShellCopy + format helpers", () => {
  it("refuses invented DEMO judge metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = judgeSimShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(judgeSimShellCopy("empty").description);
    expectPlainCopy(judgeSimShellCopy("setup").description);
  });

  it("formats real counts only and hides empty summary tiles", () => {
    expect(formatJudgeSimMetric(null, false)).toBe("…");
    expect(formatJudgeSimMetric(3, true)).toBe("3");
    expect(formatJudgeSimMetric(-1, true)).toBe("0");
    expect(formatJudgeSimReadiness(0.75, 4, true)).toBe("75%");
    expect(formatJudgeSimReadiness(0, 0, true)).toBe("—");
    expect(shouldShowJudgeSimSummaryTiles(0)).toBe(false);
    expect(shouldShowJudgeSimSummaryTiles(2)).toBe(true);
  });
});
