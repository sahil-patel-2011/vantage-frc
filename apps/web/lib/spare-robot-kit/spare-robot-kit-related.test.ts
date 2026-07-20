import { describe, expect, it } from "vitest";
import {
  SPARE_ROBOT_KIT_RELATED_INCLUDE,
  classifySpareRobotKitShell,
  formatSpareRobotKitMetric,
  spareRobotKitNextActions,
  spareRobotKitRelatedLinks,
  spareRobotKitShellCopy,
  shouldShowSpareRobotKitSummaryTiles,
} from "./spare-robot-kit-related";

describe("spareRobotKitRelatedLinks", () => {
  it("builds FMEA / Spare Forecast / Batteries cross-links", () => {
    const links = spareRobotKitRelatedLinks("org-1", {
      include: [...SPARE_ROBOT_KIT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["fmea", "spare-forecast", "batteries"]);
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(spareRobotKitRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("spareRobotKitNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = spareRobotKitNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "fmea")).toBe(true);
  });

  it("points empty boards at FMEA + Inventory", () => {
    const actions = spareRobotKitNextActions({
      orgId: "org-1",
      shell: "empty",
      candidateCount: 0,
      checklistCount: 0,
    });
    expect(actions[0]?.id).toBe("fmea");
    expect(actions.some((a) => a.id === "inventory")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize packing without DEMO metrics", () => {
    const actions = spareRobotKitNextActions({
      orgId: "org-1",
      shell: "ready",
      candidateCount: 4,
      checklistCount: 1,
    });
    expect(actions[0]?.id).toBe("pack-checklist");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifySpareRobotKitShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifySpareRobotKitShell({ loading: true })).toBe("loading");
    expect(classifySpareRobotKitShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifySpareRobotKitShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifySpareRobotKitShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        candidateCount: 0,
        checklistCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifySpareRobotKitShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        candidateCount: 3,
        checklistCount: 0,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatSpareRobotKitMetric(4, true)).toBe("4");
    expect(shouldShowSpareRobotKitSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowSpareRobotKitSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO pack lists", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = spareRobotKitShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
