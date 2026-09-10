import { describe, expect, it } from "vitest";
import {
  READINESS_SCORE_RELATED_INCLUDE,
  classifyReadinessScoreShell,
  formatReadinessScoreMetric,
  formatReadinessScorePercent,
  readinessScoreNextActions,
  readinessScoreRelatedLinks,
  readinessScoreShellCopy,
  shouldShowReadinessScoreSummaryTiles,
} from "./readiness-score-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("readinessScoreRelatedLinks", () => {
  it("builds FMEA / Inspection / Code cross-links", () => {
    const links = readinessScoreRelatedLinks("org-1", {
      include: [...READINESS_SCORE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["fmea", "inspection-copilot", "code"]);
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "inspection-copilot")?.href).toBe(
      "/build?tab=inspection-copilot&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = readinessScoreRelatedLinks("org-1", {
      active: "fmea",
      include: ["code", "cad"],
    });
    expect(links.map((l) => l.id)).toEqual(["code", "cad"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(readinessScoreRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("readinessScoreNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = readinessScoreNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "inspection-copilot")).toBe(true);
  });

  it("setup with org points at Workspace + FMEA / Inspection", () => {
    const actions = readinessScoreNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.some((a) => a.id === "inspection-copilot")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log + FMEA / Inspection", () => {
    const actions = readinessScoreNextActions({
      orgId: "org-1",
      shell: "empty",
      subsystemCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log", "fmea", "inspection-copilot"]),
    );
    expect(actions[0]?.href).toBe("#readiness-score-subsystem");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize fix list without DEMO metrics", () => {
    const actions = readinessScoreNextActions({
      orgId: "org-1",
      shell: "ready",
      subsystemCount: 3,
      fixCount: 5,
    });
    expect(actions[0]?.id).toBe("fix");
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyReadinessScoreShell + copy", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyReadinessScoreShell({ loading: true })).toBe("loading");
    expect(classifyReadinessScoreShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyReadinessScoreShell({ loading: false, status: "setup_required", orgId: null }),
    ).toBe("setup");
    expect(
      classifyReadinessScoreShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        subsystemCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyReadinessScoreShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        subsystemCount: 1,
      }),
    ).toBe("ready");
  });

  it("copy never invents DEMO readiness metrics", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = readinessScoreShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
      expect(`${copy.title} ${copy.description}`.toLowerCase()).not.toMatch(/\binvented demo\b/);
    }
  });
});

describe("formatReadinessScoreMetric", () => {
  it("formats real counts only", () => {
    expect(formatReadinessScoreMetric(null, false)).toBe("…");
    expect(formatReadinessScoreMetric(3, true)).toBe("3");
    expect(formatReadinessScoreMetric(-1, true)).toBe("0");
    expect(formatReadinessScorePercent(0.75, true)).toBe("75%");
  });

  it("hides zero summary tiles", () => {
    expect(shouldShowReadinessScoreSummaryTiles(0)).toBe(false);
    expect(shouldShowReadinessScoreSummaryTiles(2)).toBe(true);
  });
});
