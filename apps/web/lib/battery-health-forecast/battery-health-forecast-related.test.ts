import { describe, expect, it } from "vitest";
import {
  BATTERY_HEALTH_FORECAST_RELATED_INCLUDE,
  batteryHealthForecastNextActions,
  batteryHealthForecastRelatedLinks,
  batteryHealthForecastSetupSteps,
  batteryHealthForecastShellCopy,
  classifyBatteryHealthForecastShell,
  formatBatteryHealthForecastMetric,
  formatBatteryHealthForecastReadiness,
  shouldShowBatteryHealthForecastSummaryTiles,
} from "./battery-health-forecast-related";

describe("batteryHealthForecastRelatedLinks", () => {
  it("builds Battery Rotation / Batteries / Pit cross-links via hubHref / withOrgHref", () => {
    const links = batteryHealthForecastRelatedLinks("org-1", {
      include: [...BATTERY_HEALTH_FORECAST_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["battery-rotation", "batteries", "pit"]);
    expect(links.find((l) => l.id === "battery-rotation")?.href).toBe(
      "/competition?tab=battery-rotation&orgId=org-1",
    );
    expect(links.find((l) => l.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(links.find((l) => l.id === "pit")?.href).toBe("/pit?orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = batteryHealthForecastRelatedLinks("org-1", {
      active: "batteries",
      include: ["battery-rotation", "pit"],
    });
    expect(links.map((l) => l.id)).toEqual(["battery-rotation", "pit"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(batteryHealthForecastRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("batteryHealthForecastSetupSteps", () => {
  it("points setup at Workspace + Battery Rotation / Batteries / Pit", () => {
    const steps = batteryHealthForecastSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["workspace", "battery-rotation", "batteries", "pit"]);
    expect(steps.find((s) => s.id === "battery-rotation")?.href).toBe(
      "/competition?tab=battery-rotation&orgId=org-1",
    );
    expect(steps.find((s) => s.id === "batteries")?.href).toBe("/team?tab=batteries&orgId=org-1");
    expect(steps.find((s) => s.id === "pit")?.href).toBe("/pit?orgId=org-1");
  });
});

describe("batteryHealthForecastNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = batteryHealthForecastNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "battery-rotation")).toBe(true);
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "pit")).toBe(true);
  });

  it("setup with org points at Workspace + Battery Rotation / Batteries / Pit", () => {
    const actions = batteryHealthForecastNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "battery-rotation")).toBe(true);
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "pit")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at add-battery + Battery Rotation / Batteries / Pit", () => {
    const actions = batteryHealthForecastNextActions({
      orgId: "org-1",
      shell: "empty",
      batteryCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["add-battery", "battery-rotation", "batteries", "pit"]),
    );
    expect(actions[0]?.href).toBe("#bhf-add-battery");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize overdue / retire-soon without DEMO counts", () => {
    const actions = batteryHealthForecastNextActions({
      orgId: "org-1",
      shell: "ready",
      batteryCount: 4,
      overdueCount: 1,
      retireSoonCount: 2,
    });
    expect(actions[0]?.id).toBe("overdue");
    expect(actions.some((a) => a.id === "battery-rotation")).toBe(true);
    expect(actions.some((a) => a.id === "batteries")).toBe(true);
    expect(actions.some((a) => a.id === "pit")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyBatteryHealthForecastShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyBatteryHealthForecastShell({ loading: true })).toBe("loading");
    expect(classifyBatteryHealthForecastShell({ loading: false, orgId: null })).toBe("setup");
    expect(
      classifyBatteryHealthForecastShell({ loading: false, orgId: "o1", fetchFailed: true }),
    ).toBe("error");
    expect(
      classifyBatteryHealthForecastShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyBatteryHealthForecastShell({
        loading: false,
        orgId: "o1",
        status: "live",
        batteryCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyBatteryHealthForecastShell({
        loading: false,
        orgId: "o1",
        status: "live",
        batteryCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("batteryHealthForecastShellCopy + metrics", () => {
  it("refuses invented DEMO IR / EOL metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = batteryHealthForecastShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent/i);
    }
    expect(batteryHealthForecastShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(batteryHealthForecastShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides zeroed tiles / readiness", () => {
    expect(formatBatteryHealthForecastMetric(null, false)).toBe("…");
    expect(formatBatteryHealthForecastMetric(3, true)).toBe("3");
    expect(formatBatteryHealthForecastMetric(-1, true)).toBe("0");
    expect(formatBatteryHealthForecastReadiness(0.8, true, 0)).toBe("—");
    expect(formatBatteryHealthForecastReadiness(0.8, true, 2)).toBe("80%");
    expect(shouldShowBatteryHealthForecastSummaryTiles(0)).toBe(false);
    expect(shouldShowBatteryHealthForecastSummaryTiles(1)).toBe(true);
  });
});
