import { describe, expect, it } from "vitest";
import {
  OVERNIGHT_INTEL_RELATED_INCLUDE,
  classifyOvernightIntelShell,
  formatOvernightIntelMetric,
  overnightIntelNextActions,
  overnightIntelRelatedLinks,
  overnightIntelSetupSteps,
  overnightIntelShellCopy,
  overnightIntelSignalCount,
  shouldShowOvernightIntelSummaryTiles,
} from "./overnight-intel-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("overnightIntelRelatedLinks", () => {
  it("builds Event Day / Strategy / Scouting cross-links", () => {
    const links = overnightIntelRelatedLinks("org-1", {
      include: [...OVERNIGHT_INTEL_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "strategy", "scouting"]);
    expect(links.find((l) => l.id === "command")?.label).toBe("Event Day");
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

describe("overnightIntelSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    const steps = overnightIntelSetupSteps(null);
    expect(steps.map((s) => s.id)).toEqual(["workspace"]);
    expect(steps[0]?.href).toBe("/workspace");
  });

  it("missing event is only Set active event", () => {
    const steps = overnightIntelSetupSteps("org-1", { needsActiveEvent: true });
    expect(steps.map((s) => s.id)).toEqual(["active-event"]);
    expect(steps[0]?.href).toBe("/team/data?orgId=org-1");
  });
});

describe("overnightIntelNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = overnightIntelNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "command")).toBe(false);
  });

  it("setup with missing active event points at Team Data", () => {
    const actions = overnightIntelNextActions({
      orgId: "org-1",
      shell: "setup",
      needsActiveEvent: true,
    });
    expect(actions.map((a) => a.id)).toEqual(["active-event"]);
    expect(actions[0]?.href).toBe("/team/data?orgId=org-1");
  });

  it("empty and error shells do not paint a next-actions wall", () => {
    expect(
      overnightIntelNextActions({
        orgId: "org-1",
        shell: "empty",
        briefCount: 0,
        signalCount: 0,
      }),
    ).toEqual([]);
    expect(overnightIntelNextActions({ orgId: "org-1", shell: "error" })).toEqual([]);
  });

  it("ready boards prioritize latest brief without DEMO metrics or related-strip twins", () => {
    const actions = overnightIntelNextActions({
      orgId: "org-1",
      shell: "ready",
      briefCount: 2,
      signalCount: 3,
    });
    expect(actions[0]?.id).toBe("review-brief");
    expect(actions.some((a) => a.id === "epa-trend-alerts")).toBe(true);
    expect(actions.some((a) => a.id === "command")).toBe(false);
    expect(actions.some((a) => a.id === "strategy")).toBe(false);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
    for (const action of actions) expectPlainCopy(action.detail);
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

  it("copy never invents DEMO overnight metrics or org jargon", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = overnightIntelShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
      expect(copy.description).not.toMatch(/\borg\b/i);
      expect(copy.description).not.toMatch(/\bTBA\b/i);
      expect(copy.title).not.toMatch(/Intel/i);
    }
  });
});
