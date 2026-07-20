import { describe, expect, it } from "vitest";
import {
  SCOUT_ASSISTED_COUNT_RELATED_INCLUDE,
  classifyScoutAssistedCountShell,
  formatScoutAssistedCountMetric,
  scoutAssistedCountNextActions,
  scoutAssistedCountRelatedLinks,
  scoutAssistedCountShellCopy,
  shouldShowScoutAssistedCountSummaryTiles,
} from "./scout-assisted-count-related";

describe("scoutAssistedCountRelatedLinks", () => {
  it("builds Scouting / Forms / Coverage Live cross-links", () => {
    const links = scoutAssistedCountRelatedLinks("org-1", {
      include: [...SCOUT_ASSISTED_COUNT_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "forms", "scout-coverage-live"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe("/competition?tab=scouting&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutAssistedCountRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("scoutAssistedCountNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = scoutAssistedCountNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty boards at start-session", () => {
    const actions = scoutAssistedCountNextActions({
      orgId: "org-1",
      shell: "empty",
      sessionCount: 0,
    });
    expect(actions[0]?.id).toBe("start-session");
  });

  it("ready boards prioritize open taps without DEMO", () => {
    const actions = scoutAssistedCountNextActions({
      orgId: "org-1",
      shell: "ready",
      sessionCount: 3,
      openSessions: 1,
    });
    expect(actions[0]?.id).toBe("tap-open");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyScoutAssistedCountShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyScoutAssistedCountShell({ loading: true })).toBe("loading");
    expect(classifyScoutAssistedCountShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyScoutAssistedCountShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyScoutAssistedCountShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sessionCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyScoutAssistedCountShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        sessionCount: 2,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatScoutAssistedCountMetric(8, true)).toBe("8");
    expect(shouldShowScoutAssistedCountSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowScoutAssistedCountSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO tallies", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = scoutAssistedCountShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
