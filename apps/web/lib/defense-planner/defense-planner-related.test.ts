import { describe, expect, it } from "vitest";
import {
  DEFENSE_PLANNER_RELATED_INCLUDE,
  classifyDefensePlannerShell,
  defensePlannerNextActions,
  defensePlannerRelatedLinks,
  defensePlannerShellCopy,
  formatDefensePlannerMetric,
  shouldShowDefensePlannerSummaryTiles,
} from "./defense-planner-related";

describe("defensePlannerRelatedLinks", () => {
  it("builds Strategy / Scouting / Counter-book cross-links", () => {
    const links = defensePlannerRelatedLinks("org-1", {
      include: [...DEFENSE_PLANNER_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["strategy", "scouting", "counter-book"]);
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = defensePlannerRelatedLinks("org-1", {
      active: "strategy",
      include: ["scouting", "opponent-watchlist"],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "opponent-watchlist"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(defensePlannerRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("defensePlannerNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = defensePlannerNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
  });

  it("setup with org points at Workspace + Strategy / Scouting", () => {
    const actions = defensePlannerNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log + Scouting / Strategy", () => {
    const actions = defensePlannerNextActions({
      orgId: "org-1",
      shell: "empty",
      matchupCount: 0,
      hasProfile: true,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log", "scouting", "strategy"]),
    );
    expect(actions[0]?.href).toBe("#defense-planner-matchup");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize another matchup without DEMO metrics", () => {
    const actions = defensePlannerNextActions({
      orgId: "org-1",
      shell: "ready",
      matchupCount: 2,
      hasProfile: true,
    });
    expect(actions[0]?.id).toBe("another");
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyDefensePlannerShell + copy", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyDefensePlannerShell({ loading: true })).toBe("loading");
    expect(classifyDefensePlannerShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyDefensePlannerShell({ loading: false, status: "setup_required", orgId: null }),
    ).toBe("setup");
    expect(
      classifyDefensePlannerShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        matchupCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyDefensePlannerShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        matchupCount: 1,
      }),
    ).toBe("ready");
  });

  it("copy never invents DEMO defense metrics", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = defensePlannerShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|nothing is pre-seeded|scout|matchup/i,
      );
      expect(`${copy.title} ${copy.description}`.toLowerCase()).not.toMatch(/\binvented demo\b/);
    }
  });
});

describe("formatDefensePlannerMetric", () => {
  it("formats real counts only", () => {
    expect(formatDefensePlannerMetric(null, false)).toBe("…");
    expect(formatDefensePlannerMetric(3, true)).toBe("3");
    expect(formatDefensePlannerMetric(-1, true)).toBe("0");
  });

  it("hides zero summary tiles without profile", () => {
    expect(shouldShowDefensePlannerSummaryTiles({ matchupCount: 0, hasProfile: false })).toBe(
      false,
    );
    expect(shouldShowDefensePlannerSummaryTiles({ matchupCount: 0, hasProfile: true })).toBe(true);
    expect(shouldShowDefensePlannerSummaryTiles({ matchupCount: 2, hasProfile: false })).toBe(true);
  });
});
