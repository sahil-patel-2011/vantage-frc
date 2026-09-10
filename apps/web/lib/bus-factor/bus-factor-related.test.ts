import { describe, expect, it } from "vitest";
import {
  BUS_FACTOR_RELATED_INCLUDE,
  busFactorNextActions,
  busFactorRelatedLinks,
  busFactorShellCopy,
  classifyBusFactorShell,
  formatBusFactorMetric,
  formatBusFactorPercent,
  shouldShowBusFactorSummaryTiles,
} from "./bus-factor-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("busFactorRelatedLinks", () => {
  it("builds Attendance / My Hours / Task board cross-links", () => {
    const links = busFactorRelatedLinks("org-1", {
      include: [...BUS_FACTOR_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["attendance", "hours-self-view", "task-board"]);
    expect(links.find((l) => l.id === "attendance")?.href).toBe(
      "/team?tab=attendance&orgId=org-1",
    );
    expect(links.find((l) => l.id === "hours-self-view")?.href).toBe(
      "/team?tab=hours-self-view&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = busFactorRelatedLinks("org-1", {
      active: "attendance",
      include: ["hours-self-view", "knowledge"],
    });
    expect(links.map((l) => l.id)).toEqual(["hours-self-view", "knowledge"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(busFactorRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("busFactorNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = busFactorNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "attendance")).toBe(true);
    expect(actions.some((a) => a.id === "hours-self-view")).toBe(true);
  });

  it("setup with org points at Workspace + Attendance / Hours", () => {
    const actions = busFactorNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "attendance")).toBe(true);
    expect(actions.some((a) => a.id === "hours-self-view")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at log + Hours / Attendance", () => {
    const actions = busFactorNextActions({
      orgId: "org-1",
      shell: "empty",
      entryCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["log", "hours-self-view", "attendance"]),
    );
    expect(actions[0]?.href).toBe("#bus-factor-log");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize review without DEMO metrics", () => {
    const actions = busFactorNextActions({
      orgId: "org-1",
      shell: "ready",
      entryCount: 4,
      flagCount: 2,
    });
    expect(actions[0]?.id).toBe("review");
    expect(actions.some((a) => a.id === "hours-self-view")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyBusFactorShell + copy", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyBusFactorShell({ loading: true })).toBe("loading");
    expect(classifyBusFactorShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(classifyBusFactorShell({ loading: false, status: "setup_required", orgId: null })).toBe(
      "setup",
    );
    expect(
      classifyBusFactorShell({ loading: false, status: "live", orgId: "org-1", entryCount: 0 }),
    ).toBe("empty");
    expect(
      classifyBusFactorShell({ loading: false, status: "live", orgId: "org-1", entryCount: 1 }),
    ).toBe("ready");
  });

  it("copy never invents DEMO risk metrics", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = busFactorShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
      expect(`${copy.title} ${copy.description}`.toLowerCase()).not.toMatch(/\binvented demo\b/);
    }
  });
});

describe("formatBusFactorMetric", () => {
  it("formats real counts only", () => {
    expect(formatBusFactorMetric(null, false)).toBe("…");
    expect(formatBusFactorMetric(3, true)).toBe("3");
    expect(formatBusFactorMetric(-1, true)).toBe("0");
    expect(formatBusFactorPercent(0.42, true)).toBe("42%");
  });

  it("hides zero summary tiles", () => {
    expect(shouldShowBusFactorSummaryTiles(0)).toBe(false);
    expect(shouldShowBusFactorSummaryTiles(2)).toBe(true);
  });
});
