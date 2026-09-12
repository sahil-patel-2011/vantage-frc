import { describe, expect, it } from "vitest";
import {
  FAILURE_PATTERNS_RELATED_INCLUDE,
  classifyFailurePatternsShell,
  formatFailurePatternsMetric,
  failurePatternsNextActions,
  failurePatternsRelatedLinks,
  failurePatternsShellCopy,
  shouldShowFailurePatternsSummaryTiles,
} from "./failure-patterns-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("failurePatternsRelatedLinks", () => {
  it("builds Failure log / Spare Kit / Incidents cross-links", () => {
    const links = failurePatternsRelatedLinks("org-1", {
      include: [...FAILURE_PATTERNS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["fmea", "spare-robot-kit", "incident-heatmap"]);
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/build?tab=fmea&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(failurePatternsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("failurePatternsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = failurePatternsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty boards at FMEA", () => {
    const actions = failurePatternsNextActions({
      orgId: "org-1",
      shell: "empty",
      clusterCount: 0,
    });
    expect(actions[0]?.id).toBe("fmea");
  });

  it("ready boards prioritize critical without DEMO", () => {
    const actions = failurePatternsNextActions({
      orgId: "org-1",
      shell: "ready",
      clusterCount: 4,
      criticalCount: 1,
    });
    expect(actions[0]?.id).toBe("review-critical");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyFailurePatternsShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyFailurePatternsShell({ loading: true })).toBe("loading");
    expect(classifyFailurePatternsShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyFailurePatternsShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyFailurePatternsShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        clusterCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyFailurePatternsShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        clusterCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatFailurePatternsMetric(5, true)).toBe("5");
    expect(shouldShowFailurePatternsSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowFailurePatternsSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO clusters", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = failurePatternsShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
