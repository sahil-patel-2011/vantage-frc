import { describe, expect, it } from "vitest";
import {
  CAD_CHANGE_RADAR_RELATED_INCLUDE,
  cadChangeRadarNextActions,
  cadChangeRadarRelatedLinks,
  cadChangeRadarShellCopy,
  classifyCadChangeRadarShell,
  formatCadChangeRadarMetric,
  shouldShowCadChangeRadarSummaryTiles,
} from "./cad-change-radar-related";

describe("cadChangeRadarRelatedLinks", () => {
  it("builds CAD / FMEA / Prototypes cross-links", () => {
    const links = cadChangeRadarRelatedLinks("org-1", {
      include: [...CAD_CHANGE_RADAR_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["cad", "fmea", "prototype"]);
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(cadChangeRadarRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("cadChangeRadarNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = cadChangeRadarNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "cad")).toBe(true);
  });

  it("setup with org points at CAD", () => {
    const actions = cadChangeRadarNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("cad");
    expect(actions[0]?.href).toBe("/build?tab=cad&orgId=org-1");
  });

  it("points empty boards at snapshot + CAD", () => {
    const actions = cadChangeRadarNextActions({
      orgId: "org-1",
      shell: "empty",
      snapshotCount: 0,
      diffCount: 0,
    });
    expect(actions[0]?.href).toBe("#cad-change-radar-snapshot");
    expect(actions.some((a) => a.id === "cad")).toBe(true);
  });

  it("ready boards prioritize unread alerts without DEMO metrics", () => {
    const actions = cadChangeRadarNextActions({
      orgId: "org-1",
      shell: "ready",
      snapshotCount: 3,
      diffCount: 2,
      unreadCount: 1,
    });
    expect(actions[0]?.id).toBe("alerts");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyCadChangeRadarShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyCadChangeRadarShell({ loading: true })).toBe("loading");
    expect(classifyCadChangeRadarShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyCadChangeRadarShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyCadChangeRadarShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        snapshotCount: 0,
        diffCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyCadChangeRadarShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        snapshotCount: 2,
        diffCount: 1,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatCadChangeRadarMetric(2, true)).toBe("2");
    expect(shouldShowCadChangeRadarSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowCadChangeRadarSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO revision diffs", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = cadChangeRadarShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
