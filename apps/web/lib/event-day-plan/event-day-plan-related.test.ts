import { describe, expect, it } from "vitest";
import {
  EVENT_DAY_PLAN_RELATED_INCLUDE,
  classifyEventDayPlanShell,
  eventDayPlanNextActions,
  eventDayPlanRelatedLinks,
  eventDayPlanSetupSteps,
  eventDayPlanShellCopy,
  formatEventDayPlanMetric,
  shouldShowEventDayPlanSummaryTiles,
} from "./event-day-plan-related";
import { expectPlainCopy } from "../ui/copy-assertions";

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

describe("eventDayPlanSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    expect(eventDayPlanSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });

  it("keeps Sync Team Data; Command / Batteries / Pit live on the related strip", () => {
    const steps = eventDayPlanSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["team-data"]);
    expect(steps[0]?.href).toBe("/team/data?orgId=org-1");
  });
});

describe("eventDayPlanNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = eventDayPlanNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
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
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
