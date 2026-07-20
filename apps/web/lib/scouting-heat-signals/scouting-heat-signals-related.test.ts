import { describe, expect, it } from "vitest";
import {
  SCOUTING_HEAT_SIGNALS_RELATED_INCLUDE,
  classifyScoutingHeatSignalsShell,
  formatScoutingHeatSignalsMetric,
  scoutingHeatSignalsNextActions,
  scoutingHeatSignalsRelatedLinks,
  scoutingHeatSignalsShellCopy,
  shouldShowScoutingHeatSignalsSummaryTiles,
} from "./scouting-heat-signals-related";

describe("scoutingHeatSignalsRelatedLinks", () => {
  it("builds Scouting / Watchlist / Pick List cross-links", () => {
    const links = scoutingHeatSignalsRelatedLinks("org-1", {
      include: [...SCOUTING_HEAT_SIGNALS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "opponent-watchlist", "picklist-collab"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutingHeatSignalsRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutingHeatSignalsNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = scoutingHeatSignalsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("points empty boards at log + Scouting", () => {
    const actions = scoutingHeatSignalsNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions[0]?.href).toBe("#scouting-heat-log");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize rising teams without DEMO metrics", () => {
    const actions = scoutingHeatSignalsNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 4,
      risingCount: 2,
    });
    expect(actions[0]?.id).toBe("review-rising");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyScoutingHeatSignalsShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyScoutingHeatSignalsShell({ loading: true })).toBe("loading");
    expect(classifyScoutingHeatSignalsShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyScoutingHeatSignalsShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyScoutingHeatSignalsShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        entryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyScoutingHeatSignalsShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        entryCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatScoutingHeatSignalsMetric(4, true)).toBe("4");
    expect(shouldShowScoutingHeatSignalsSummaryTiles(0)).toBe(false);
    expect(shouldShowScoutingHeatSignalsSummaryTiles(1)).toBe(true);
  });

  it("copy never invents DEMO trend arrows", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = scoutingHeatSignalsShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
