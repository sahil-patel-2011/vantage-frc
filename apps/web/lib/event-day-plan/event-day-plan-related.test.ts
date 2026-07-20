import { describe, expect, it } from "vitest";
import {
  EVENT_DAY_PLAN_RELATED_INCLUDE,
  classifyEventDayPlanShell,
  eventDayPlanNextActions,
  eventDayPlanRelatedLinks,
  eventDayPlanShellCopy,
  formatEventDayPlanMetric,
  shouldShowEventDayPlanSummaryTiles,
} from "./event-day-plan-related";

describe("eventDayPlanRelatedLinks", () => {
  it("builds Command / Battery / Pit cross-links", () => {
    const links = eventDayPlanRelatedLinks("org-1", {
      include: [...EVENT_DAY_PLAN_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "battery-rotation", "pit-repair-triage"]);
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(eventDayPlanRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("eventDayPlanNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = eventDayPlanNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "command")).toBe(true);
  });

  it("points empty boards at add-block + Command", () => {
    const actions = eventDayPlanNextActions({
      orgId: "org-1",
      shell: "empty",
      blockCount: 0,
    });
    expect(actions[0]?.href).toBe("#event-day-plan-add");
    expect(actions.some((a) => a.id === "command")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize conflicts without DEMO metrics", () => {
    const actions = eventDayPlanNextActions({
      orgId: "org-1",
      shell: "ready",
      blockCount: 4,
      conflictCount: 2,
    });
    expect(actions[0]?.id).toBe("resolve-conflicts");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyEventDayPlanShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyEventDayPlanShell({ loading: true })).toBe("loading");
    expect(classifyEventDayPlanShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyEventDayPlanShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyEventDayPlanShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        blockCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyEventDayPlanShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        blockCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatEventDayPlanMetric(4, true)).toBe("4");
    expect(shouldShowEventDayPlanSummaryTiles(0)).toBe(false);
    expect(shouldShowEventDayPlanSummaryTiles(1)).toBe(true);
  });

  it("copy never invents DEMO schedule blocks", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = eventDayPlanShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
