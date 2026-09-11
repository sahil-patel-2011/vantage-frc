import { describe, expect, it } from "vitest";
import {
  HOURS_SELF_VIEW_RELATED_INCLUDE,
  classifyHoursSelfViewShell,
  formatHoursSelfViewHours,
  formatHoursSelfViewMetric,
  hoursSelfViewNextActions,
  hoursSelfViewRelatedLinks,
  hoursSelfViewShellCopy,
  shouldShowHoursSelfViewSummaryTiles,
} from "./hours-self-view-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("hoursSelfViewRelatedLinks", () => {
  it("builds Attendance / Mentor Hours / Team Health cross-links", () => {
    const links = hoursSelfViewRelatedLinks("org-1", {
      include: [...HOURS_SELF_VIEW_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["attendance", "mentor-hours", "team-health-dashboard"]);
    expect(links.find((l) => l.id === "attendance")?.href).toBe(
      "/team?tab=attendance&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(hoursSelfViewRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("hoursSelfViewNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = hoursSelfViewNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions).toHaveLength(1);
  });

  it("points empty boards at Clock in on this page", () => {
    const actions = hoursSelfViewNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions[0]?.id).toBe("clock-in");
    expect(actions[0]?.label).toBe("Clock in");
    expect(actions).toHaveLength(1);
  });

  it("ready boards review sessions without DEMO metrics", () => {
    const actions = hoursSelfViewNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 4,
      kioskCount: 0,
    });
    expect(actions[0]?.id).toBe("review-sessions");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyHoursSelfViewShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyHoursSelfViewShell({ loading: true })).toBe("loading");
    expect(classifyHoursSelfViewShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyHoursSelfViewShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyHoursSelfViewShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        entryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyHoursSelfViewShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        entryCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatHoursSelfViewMetric(4, true)).toBe("4");
    expect(formatHoursSelfViewHours(12.34, true)).toBe("12.3");
    expect(shouldShowHoursSelfViewSummaryTiles(0)).toBe(false);
    expect(shouldShowHoursSelfViewSummaryTiles(1)).toBe(true);
  });

  it("copy never invents DEMO hour totals", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = hoursSelfViewShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
