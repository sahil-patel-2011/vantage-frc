import { describe, expect, it } from "vitest";
import {
  INSPECTION_COPILOT_RELATED_INCLUDE,
  classifyInspectionCopilotShell,
  formatInspectionCopilotMetric,
  formatInspectionRiskPct,
  inspectionCopilotNextActions,
  inspectionCopilotRelatedLinks,
  inspectionCopilotShellCopy,
  inspectionSetupSteps,
} from "./inspection-copilot-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("inspectionCopilotRelatedLinks", () => {
  it("builds Batteries / FMEA / Weigh-in cross-links", () => {
    const links = inspectionCopilotRelatedLinks("org-1", {
      include: [...INSPECTION_COPILOT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["batteries", "fmea", "weigh-in"]);
    expect(links.find((l) => l.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "weigh-in")?.href).toBe("/build?tab=robot-weigh-in&orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = inspectionCopilotRelatedLinks("org-1", {
      active: "fmea",
      include: ["batteries", "subsystems"],
    });
    expect(links.map((l) => l.id)).toEqual(["batteries", "subsystems"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(inspectionCopilotRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("inspectionCopilotNextActions", () => {
  it("setup without a team is one Choose your team step (Batteries / FMEA / Weigh-in live in the related strip)", () => {
    const actions = inspectionCopilotNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("setup with org derives from inspectionSetupSteps", () => {
    const steps = inspectionSetupSteps("org-1");
    const actions = inspectionCopilotNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(steps.map((s) => s.id));
    expect(actions[0]?.id).toBe("workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions).toHaveLength(1);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at run-check plus Subsystems (Batteries / FMEA live in the related strip)", () => {
    const actions = inspectionCopilotNextActions({
      orgId: "org-1",
      shell: "empty",
      checkCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(["run-check", "subsystems"]);
    expect(actions[0]?.href).toBe("#inspection-copilot-form");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize critical flags without DEMO metrics", () => {
    const actions = inspectionCopilotNextActions({
      orgId: "org-1",
      shell: "ready",
      checkCount: 2,
      flaggedCount: 2,
      criticalCount: 1,
    });
    expect(actions[0]?.id).toBe("resolve-critical");
    expect(actions.some((a) => a.id === "batteries")).toBe(false);
    expect(actions.some((a) => a.id === "fmea")).toBe(false);
    expect(actions.some((a) => a.id === "subsystems")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyInspectionCopilotShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyInspectionCopilotShell({ loading: true })).toBe("loading");
    expect(classifyInspectionCopilotShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyInspectionCopilotShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyInspectionCopilotShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyInspectionCopilotShell({
        loading: false,
        orgId: "o1",
        status: "live",
        checkCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyInspectionCopilotShell({
        loading: false,
        orgId: "o1",
        status: "live",
        checkCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("inspectionCopilotShellCopy + format helpers", () => {
  it("refuses invented DEMO inspection metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = inspectionCopilotShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(inspectionCopilotShellCopy("empty").description);
    expectPlainCopy(inspectionCopilotShellCopy("setup").description);
  });

  it("formats real counts and blanks risk until checks exist", () => {
    expect(formatInspectionCopilotMetric(null, false)).toBe("…");
    expect(formatInspectionCopilotMetric(3, true)).toBe("3");
    expect(formatInspectionCopilotMetric(-1, true)).toBe("0");
    expect(formatInspectionRiskPct(0.42, true, false)).toBe("—");
    expect(formatInspectionRiskPct(0.42, true, true)).toBe("42%");
  });
});
