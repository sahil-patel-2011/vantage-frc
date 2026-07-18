import { describe, expect, it } from "vitest";
import {
  OVERNIGHT_INTEL_RELATED_INCLUDE,
  classifyOvernightIntelShell,
  formatOvernightIntelMetric,
  overnightIntelNextActions,
  overnightIntelRelatedLinks,
  overnightIntelShellCopy,
  overnightIntelSignalCount,
  shouldShowOvernightIntelSummaryTiles,
} from "./overnight-intel-related";

describe("overnightIntelRelatedLinks", () => {
  it("builds Command / Strategy / Scouting cross-links", () => {
    const links = overnightIntelRelatedLinks("org-1", {
      include: [...OVERNIGHT_INTEL_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "strategy", "scouting"]);
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(overnightIntelRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("overnightIntelNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = overnightIntelNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "command")).toBe(true);
  });

  it("setup with missing active event points at Team Data", () => {
    const actions = overnightIntelNextActions({
      orgId: "org-1",
      shell: "setup",
      needsActiveEvent: true,
    });
    expect(actions[0]?.id).toBe("active-event");
    expect(actions[0]?.href).toBe("/team/data?orgId=org-1");
  });

  it("points empty boards at generate + Scouting / Command", () => {
    const actions = overnightIntelNextActions({
      orgId: "org-1",
      shell: "empty",
      briefCount: 0,
      signalCount: 0,
    });
    expect(actions[0]?.href).toBe("#overnight-intel-generate");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize latest brief without DEMO metrics", () => {
    const actions = overnightIntelNextActions({
      orgId: "org-1",
      shell: "ready",
      briefCount: 2,
      signalCount: 3,
    });
    expect(actions[0]?.id).toBe("review-brief");
    expect(actions.some((a) => a.id === "epa-trend-alerts")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyOvernightIntelShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyOvernightIntelShell({ loading: true })).toBe("loading");
    expect(classifyOvernightIntelShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyOvernightIntelShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyOvernightIntelShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        briefCount: 0,
        signalCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyOvernightIntelShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        briefCount: 0,
        signalCount: 2,
      }),
    ).toBe("ready");
  });

  it("counts signals and formats metrics", () => {
    expect(
      overnightIntelSignalCount({
        researchHighlights: [{}],
        epaMovers: [{}, {}],
        scoutingHighlights: [],
      }),
    ).toBe(3);
    expect(formatOvernightIntelMetric(4, true)).toBe("4");
    expect(shouldShowOvernightIntelSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowOvernightIntelSummaryTiles(0, 1)).toBe(true);
  });

  it("copy never invents DEMO overnight metrics", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = overnightIntelShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
