import { describe, expect, it } from "vitest";
import {
  EQUIPMENT_MAINTENANCE_RELATED_INCLUDE,
  classifyEquipmentMaintenanceShell,
  formatEquipmentMaintenanceMetric,
  equipmentMaintenanceNextActions,
  equipmentMaintenanceRelatedLinks,
  equipmentMaintenanceShellCopy,
  shouldShowEquipmentMaintenanceSummaryTiles,
} from "./equipment-maintenance-related";

describe("equipmentMaintenanceRelatedLinks", () => {
  it("builds Tool Checkout / Safety / Checklist cross-links", () => {
    const links = equipmentMaintenanceRelatedLinks("org-1", {
      include: [...EQUIPMENT_MAINTENANCE_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual([
      "tool-checkout",
      "safety-training",
      "checklist-library",
    ]);
    expect(links.find((l) => l.id === "tool-checkout")?.href).toBe(
      "/team?tab=tool-checkout&orgId=org-1",
    );
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(equipmentMaintenanceRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("equipmentMaintenanceNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = equipmentMaintenanceNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions.some((a) => a.id === "tools")).toBe(true);
  });

  it("points empty boards at add-asset", () => {
    const actions = equipmentMaintenanceNextActions({
      orgId: "org-1",
      shell: "empty",
      assetCount: 0,
    });
    expect(actions[0]?.id).toBe("add-asset");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize overdue without DEMO metrics", () => {
    const actions = equipmentMaintenanceNextActions({
      orgId: "org-1",
      shell: "ready",
      assetCount: 4,
      overdueCount: 1,
    });
    expect(actions[0]?.id).toBe("overdue");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyEquipmentMaintenanceShell + helpers", () => {
  it("classifies loading / error / setup / empty / ready", () => {
    expect(classifyEquipmentMaintenanceShell({ loading: true })).toBe("loading");
    expect(classifyEquipmentMaintenanceShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyEquipmentMaintenanceShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyEquipmentMaintenanceShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        assetCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyEquipmentMaintenanceShell({
        loading: false,
        status: "live",
        orgId: "org-1",
        assetCount: 3,
      }),
    ).toBe("ready");
  });

  it("formats metrics and hides zero tiles", () => {
    expect(formatEquipmentMaintenanceMetric(4, true)).toBe("4");
    expect(shouldShowEquipmentMaintenanceSummaryTiles(0, 0)).toBe(false);
    expect(shouldShowEquipmentMaintenanceSummaryTiles(1, 0)).toBe(true);
  });

  it("copy never invents DEMO service packs", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = equipmentMaintenanceShellCopy(kind);
      expect(`${copy.title} ${copy.description}`).toMatch(
        /never DEMO|never invent DEMO|nothing is pre-seeded/i,
      );
    }
  });
});
