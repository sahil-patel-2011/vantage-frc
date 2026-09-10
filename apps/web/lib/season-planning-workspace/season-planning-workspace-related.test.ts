import { describe, expect, it } from "vitest";
import {
  SEASON_PLANNING_RELATED_INCLUDE,
  classifySeasonPlanningShell,
  formatSeasonPlanningMetric,
  seasonPlanningNextActions,
  seasonPlanningRelatedLinks,
  seasonPlanningShellCopy,
  shouldShowSeasonPlanningSummaryTiles,
} from "./season-planning-workspace-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("seasonPlanningRelatedLinks", () => {
  it("builds Goals / Calendar / Attendance cross-links", () => {
    const links = seasonPlanningRelatedLinks("org-1", {
      include: [...SEASON_PLANNING_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["goals-tracker", "calendar", "attendance"]);
    expect(links.find((l) => l.id === "calendar")?.href).toBe(
      "/team?tab=calendar&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    expect(JSON.stringify(seasonPlanningRelatedLinks("org-1"))).not.toMatch(/DEMO/i);
  });
});

describe("seasonPlanningNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = seasonPlanningNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
  });

  it("points empty plans at create", () => {
    const actions = seasonPlanningNextActions({ orgId: "org-1", shell: "empty" });
    expect(actions[0]?.id).toBe("create");
    expect(actions[0]?.href).toBe("#season-plan-create");
  });

  it("ready plans prioritize milestones without DEMO %", () => {
    const actions = seasonPlanningNextActions({
      orgId: "org-1",
      shell: "ready",
      goalsTotal: 2,
      milestonesTotal: 1,
    });
    expect(actions[0]?.id).toBe("milestones");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifySeasonPlanningShell", () => {
  it("classifies shells", () => {
    expect(classifySeasonPlanningShell({ loading: true })).toBe("loading");
    expect(classifySeasonPlanningShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(classifySeasonPlanningShell({ status: "empty", orgId: "o" })).toBe("empty");
    expect(classifySeasonPlanningShell({ status: "live", orgId: "o" })).toBe("ready");
  });
});

describe("formatSeasonPlanningMetric", () => {
  it("formats real counts only", () => {
    expect(formatSeasonPlanningMetric(4, true)).toBe("4");
    expect(formatSeasonPlanningMetric(0, false)).toBe("…");
    expect(shouldShowSeasonPlanningSummaryTiles({ goalsTotal: 0, milestonesTotal: 0 })).toBe(
      false,
    );
  });
});

describe("seasonPlanningShellCopy", () => {
  it("never invents DEMO completion", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = seasonPlanningShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
