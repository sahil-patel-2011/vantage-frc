import { describe, expect, it } from "vitest";
import {
  BATTERY_ROTATION_RELATED_INCLUDE,
  batteryRotationNextActions,
  batteryRotationRelatedLinks,
  batteryRotationSetupSteps,
  batteryRotationShellCopy,
  classifyBatteryRotationShell,
  formatBatteryRotationMetric,
  formatBatteryRotationPlanReadiness,
  shouldShowBatteryRotationSummaryTiles,
} from "./battery-rotation-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("batteryRotationRelatedLinks", () => {
  it("builds Batteries / Health Forecast / Pit cross-links via hubHref / withOrgHref", () => {
    const links = batteryRotationRelatedLinks("org-1", {
      include: [...BATTERY_ROTATION_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["batteries", "battery-health-forecast", "pit"]);
    expect(links.find((l) => l.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(links.find((l) => l.id === "battery-health-forecast")?.href).toBe(
      "/build?tab=battery-health-forecast&orgId=org-1",
    );
    expect(links.find((l) => l.id === "pit")?.href).toBe("/pit?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = batteryRotationRelatedLinks("org-1", {
      active: "batteries",
      include: ["battery-health-forecast", "pit"],
    });
    expect(links.map((l) => l.id)).toEqual(["battery-health-forecast", "pit"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(batteryRotationRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("batteryRotationSetupSteps", () => {
  it("points setup at Workspace + Batteries / Health Forecast / Pit", () => {
    const steps = batteryRotationSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual([
      "workspace",
      "batteries",
      "battery-health-forecast",
      "pit",
    ]);
    expect(steps.find((s) => s.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(steps.find((s) => s.id === "battery-health-forecast")?.href).toBe(
      "/build?tab=battery-health-forecast&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "pit")?.href).toBe("/pit?orgId=org-1");
  });
});

describe("batteryRotationNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = batteryRotationNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "battery-health-forecast")).toBe(true);
    expect(actions.some((a) => a.id === "pit")).toBe(true);
  });

  it("setup with org points at Workspace + Batteries / Health Forecast / Pit", () => {
    const actions = batteryRotationNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "battery-health-forecast")).toBe(true);
    expect(actions.some((a) => a.id === "pit")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at add-battery + Batteries / Health Forecast / Pit", () => {
    const actions = batteryRotationNextActions({
      orgId: "org-1",
      shell: "empty",
      batteryCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["add-battery", "batteries", "battery-health-forecast", "pit"]),
    );
    expect(actions[0]?.href).toBe("#br-add-battery");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize short-packs without DEMO counts", () => {
    const actions = batteryRotationNextActions({
      orgId: "org-1",
      shell: "ready",
      batteryCount: 4,
      shortPackCount: 1,
      chargeShortfallCount: 2,
    });
    expect(actions[0]?.id).toBe("short-packs");
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "battery-health-forecast")).toBe(true);
    expect(actions.some((a) => a.id === "pit")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyBatteryRotationShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyBatteryRotationShell({ loading: true })).toBe("loading");
    expect(classifyBatteryRotationShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyBatteryRotationShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe(
      "error",
    );
    expect(
      classifyBatteryRotationShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyBatteryRotationShell({
        loading: false,
        orgId: "o1",
        status: "live",
        batteryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyBatteryRotationShell({
        loading: false,
        orgId: "o1",
        status: "live",
        batteryCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("batteryRotationShellCopy + metrics", () => {
  it("refuses invented DEMO IR / charge metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = batteryRotationShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(batteryRotationShellCopy("empty").description);
    expectPlainCopy(batteryRotationShellCopy("setup").description);
  });

  it("formats real counts only and hides zeroed tiles / readiness", () => {
    expect(formatBatteryRotationMetric(null, false)).toBe("…");
    expect(formatBatteryRotationMetric(3, true)).toBe("3");
    expect(formatBatteryRotationMetric(-1, true)).toBe("0");
    expect(formatBatteryRotationPlanReadiness(0.8, true, 0)).toBe("—");
    expect(formatBatteryRotationPlanReadiness(0.8, true, 2)).toBe("80%");
    expect(shouldShowBatteryRotationSummaryTiles(0)).toBe(false);
    expect(shouldShowBatteryRotationSummaryTiles(1)).toBe(true);
  });
});
