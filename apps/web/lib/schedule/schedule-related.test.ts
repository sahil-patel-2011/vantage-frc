import { describe, expect, it } from "vitest";
import {
  SCHEDULE_RELATED_INCLUDE,
  classifyScheduleShell,
  scheduleNextActions,
  scheduleRelatedLinks,
} from "./schedule-related";

describe("scheduleRelatedLinks", () => {
  it("builds Calendar / Event Day / My Day cross-links", () => {
    const links = scheduleRelatedLinks("org-1", { include: [...SCHEDULE_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["calendar", "command", "my-day", "scouting"]);
    expect(links.find((l) => l.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(links.find((l) => l.id === "my-day")?.href).toBe("/competition?tab=my-day&orgId=org-1");
    expect(links.find((l) => l.id === "scouting")?.href).toBe("/scouting?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = scheduleRelatedLinks("org-1", {
      active: "calendar",
      include: ["command", "my-day"],
    });
    expect(links.map((l) => l.id)).toEqual(["command", "my-day"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(scheduleRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("scheduleNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = scheduleNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
  });

  it("points empty boards at Event Day / My Day / Calendar — never DEMO matches", () => {
    const actions = scheduleNextActions({
      orgId: "org-1",
      shell: "empty",
      hasActiveEvent: true,
      matchCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["command", "my-day", "calendar"]),
    );
    expect(actions.every((a) => !/\bdemo match\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize My Day", () => {
    const actions = scheduleNextActions({
      orgId: "org-1",
      shell: "ready",
      matchCount: 12,
    });
    expect(actions[0]?.id).toBe("my-day");
    expect(actions.some((a) => a.id === "calendar")).toBe(true);
    expect(actions.some((a) => a.id === "command")).toBe(true);
  });

  it("setup without active event sends users to Workspace + Event Day", () => {
    const actions = scheduleNextActions({
      orgId: "org-1",
      shell: "setup",
      hasActiveEvent: false,
    });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "command")).toBe(true);
  });
});

describe("classifyScheduleShell", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyScheduleShell({ loading: true })).toBe("loading");
    expect(classifyScheduleShell({ loading: false, fetchFailed: true, status: null })).toBe("error");
    expect(classifyScheduleShell({ loading: false, status: "setup_required" })).toBe("setup");
    expect(classifyScheduleShell({ loading: false, status: "ready", matchCount: 0 })).toBe("empty");
    expect(classifyScheduleShell({ loading: false, status: "ready", matchCount: 3 })).toBe("ready");
  });
});
