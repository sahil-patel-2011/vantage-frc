import { describe, expect, it } from "vitest";
import {
  SKETCH_TO_BRIEF_RELATED_INCLUDE,
  classifySketchToBriefShell,
  formatSketchToBriefMetric,
  sketchToBriefNextActions,
  sketchToBriefRelatedLinks,
  sketchToBriefShellCopy,
} from "./sketch-to-brief-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("sketchToBriefRelatedLinks", () => {
  it("builds Kickoff / CAD cross-links", () => {
    const links = sketchToBriefRelatedLinks("org-1", {
      include: [...SKETCH_TO_BRIEF_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["kickoff", "cad"]);
    expect(links.find((l) => l.id === "kickoff")?.href).toBe("/build?tab=kickoff&orgId=org-1");
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = sketchToBriefRelatedLinks("org-1", {
      active: "cad",
      include: ["kickoff", "rule-impact"],
    });
    expect(links.map((l) => l.id)).toEqual(["kickoff", "rule-impact"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(sketchToBriefRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("sketchToBriefNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = sketchToBriefNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
  });

  it("setup with org points at Workspace + Kickoff / CAD", () => {
    const actions = sketchToBriefNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log-sketch + Kickoff / CAD", () => {
    const actions = sketchToBriefNextActions({
      orgId: "org-1",
      shell: "empty",
      sketchCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log-sketch", "kickoff", "cad"]),
    );
    expect(actions[0]?.href).toBe("#sketch-to-brief-log-sketch");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize brief generation / flags without DEMO metrics", () => {
    const actions = sketchToBriefNextActions({
      orgId: "org-1",
      shell: "ready",
      sketchCount: 2,
      briefCount: 0,
      draftCount: 2,
      ruleFlagCount: 0,
    });
    expect(actions[0]?.id).toBe("generate-brief");
    expect(actions.some((a) => a.id === "kickoff")).toBe(true);
    expect(actions.some((a) => a.id === "cad")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifySketchToBriefShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifySketchToBriefShell({ loading: true })).toBe("loading");
    expect(classifySketchToBriefShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifySketchToBriefShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifySketchToBriefShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifySketchToBriefShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sketchCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifySketchToBriefShell({
        loading: false,
        orgId: "o1",
        status: "live",
        sketchCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("sketchToBriefShellCopy + format helpers", () => {
  it("refuses invented DEMO brief metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = sketchToBriefShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(sketchToBriefShellCopy("empty").description);
    expectPlainCopy(sketchToBriefShellCopy("setup").description);
  });

  it("formats real counts only", () => {
    expect(formatSketchToBriefMetric(null, false)).toBe("…");
    expect(formatSketchToBriefMetric(3, true)).toBe("3");
    expect(formatSketchToBriefMetric(-1, true)).toBe("0");
  });
});
