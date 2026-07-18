import { describe, expect, it } from "vitest";
import {
  SCOUT_ACCURACY_RELATED_INCLUDE,
  classifyScoutAccuracyShell,
  formatScoutAccuracyMetric,
  formatScoutAccuracyRate,
  formatScoutAccuracyScore,
  isScoutAccuracyLeaderboardEmpty,
  scoutAccuracyNextActions,
  scoutAccuracyRelatedLinks,
  scoutAccuracySetupSteps,
  scoutAccuracyShellCopy,
  shouldShowScoutAccuracySummaryTiles,
} from "./scout-accuracy-related";

describe("scoutAccuracyRelatedLinks", () => {
  it("builds Scouting / Coverage / Strategy via hubHref / withOrgHref", () => {
    const links = scoutAccuracyRelatedLinks("org-1", {
      include: [...SCOUT_ACCURACY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "coverage", "strategy"]);
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "coverage")?.href).toBe(
      "/scouting/lineup?orgId=org-1",
    );
    expect(links.find((l) => l.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scoutAccuracyRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scoutAccuracySetupSteps", () => {
  it("uses hubHref / withOrgHref and never DEMO scores", () => {
    const steps = scoutAccuracySetupSteps("org-1");
    expect(steps.find((s) => s.id === "workspace")?.href).toBe("/workspace?orgId=org-1");
    expect(steps.find((s) => s.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "coverage")?.href).toBe("/scouting/lineup?orgId=org-1");
    expect(steps.find((s) => s.id === "strategy")?.href).toBe(
      "/competition?tab=strategy&orgId=org-1",
    );
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
    expect(steps.every((s) => !/demo/i.test(s.href))).toBe(true);
  });
});

describe("Scout Accuracy Soft-UI metrics", () => {
  it("formats real counts only", () => {
    expect(formatScoutAccuracyMetric(3, true)).toBe("3");
    expect(formatScoutAccuracyMetric(0, false)).toBe("…");
    expect(formatScoutAccuracyMetric(-1, true)).toBe("0");
  });

  it("formats scores without inventing DEMO values", () => {
    expect(formatScoutAccuracyScore(82, true)).toBe("82");
    expect(formatScoutAccuracyScore(0, false)).toBe("…");
    expect(formatScoutAccuracyScore(null, true)).toBe("—");
    expect(formatScoutAccuracyScore(0, true, { hasVerifiable: false })).toBe("—");
    expect(formatScoutAccuracyScore(120, true)).toBe("100");
  });

  it("formats rates without inventing DEMO %", () => {
    expect(formatScoutAccuracyRate(0.5, true)).toBe("50%");
    expect(formatScoutAccuracyRate(0, false)).toBe("…");
    expect(formatScoutAccuracyRate(null, true)).toBe("—");
  });

  it("hides summary tiles without real entries", () => {
    expect(shouldShowScoutAccuracySummaryTiles({ totalEntries: 0, totalScouts: 0 })).toBe(false);
    expect(shouldShowScoutAccuracySummaryTiles({ totalEntries: 4, totalScouts: 2 })).toBe(true);
  });

  it("treats missing event / zero entries as empty", () => {
    expect(isScoutAccuracyLeaderboardEmpty({ eventKey: null, totalEntries: 0 })).toBe(true);
    expect(isScoutAccuracyLeaderboardEmpty({ eventKey: "2026casj", totalEntries: 0 })).toBe(true);
    expect(isScoutAccuracyLeaderboardEmpty({ eventKey: "2026casj", totalEntries: 2 })).toBe(false);
  });
});

describe("classifyScoutAccuracyShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO scores", () => {
    expect(classifyScoutAccuracyShell({ loading: true })).toBe("loading");
    expect(classifyScoutAccuracyShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifyScoutAccuracyShell({ status: "setup_required" })).toBe("setup");
    expect(classifyScoutAccuracyShell({ orgId: null, status: "live" })).toBe("setup");
    expect(
      classifyScoutAccuracyShell({
        orgId: "o",
        status: "live",
        eventKey: null,
        totalEntries: 0,
      }),
    ).toBe("empty");
    expect(
      classifyScoutAccuracyShell({
        orgId: "o",
        status: "live",
        eventKey: "2026casj",
        totalEntries: 8,
      }),
    ).toBe("ready");
  });
});

describe("scoutAccuracyShellCopy", () => {
  it("refuses invented DEMO scores in empty/setup copy", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = scoutAccuracyShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
    }
    expect(scoutAccuracyShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(scoutAccuracyShellCopy("setup").badge).toBe("Setup required");
  });
});

describe("scoutAccuracyNextActions", () => {
  it("prioritizes workspace when no org", () => {
    const actions = scoutAccuracyNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
  });

  it("setup with org points at Scouting / Coverage / Strategy", () => {
    const actions = scoutAccuracyNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
    expect(actions.every((a) => !/demo/i.test(a.href))).toBe(true);
  });

  it("empty shell points at Scouting / Coverage / Strategy", () => {
    const actions = scoutAccuracyNextActions({
      orgId: "org-1",
      shell: "empty",
      totalEntries: 0,
    });
    expect(actions[0]?.id).toBe("scouting");
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["coverage", "strategy", "command"]),
    );
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize promotions without DEMO scores", () => {
    const actions = scoutAccuracyNextActions({
      orgId: "org-1",
      shell: "ready",
      totalEntries: 12,
      suggestedPromotions: 2,
    });
    expect(actions[0]?.id).toBe("rotation");
    expect(actions[0]?.href).toBe("#accuracy-leaderboard");
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.some((a) => a.id === "strategy")).toBe(true);
    expect(actions.every((a) => !/\bDEMO\b/.test(a.label))).toBe(true);
  });
});
