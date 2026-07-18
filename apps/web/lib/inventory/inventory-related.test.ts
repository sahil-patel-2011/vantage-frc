import { describe, expect, it } from "vitest";
import {
  INVENTORY_RELATED_INCLUDE,
  classifyInventoryShell,
  formatInventoryMetric,
  formatInventoryMoney,
  inventoryNextActions,
  inventoryRelatedLinks,
  inventorySetupSteps,
  inventoryShellCopy,
  shouldShowInventorySummaryTiles,
} from "./inventory-related";

describe("inventoryRelatedLinks", () => {
  it("builds Vendors / Orders / Spare Forecast cross-links via hubHref / withOrgHref", () => {
    const links = inventoryRelatedLinks("org-1", {
      include: [...INVENTORY_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["vendors", "orders", "spare-forecast"]);
    expect(links.find((l) => l.id === "vendors")?.href).toBe("/vendors?orgId=org-1");
    expect(links.find((l) => l.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(links.find((l) => l.id === "spare-forecast")?.href).toBe(
      "/build?tab=spare-forecast&orgId=org-1",
    );
  });

  it("excludes the active surface and respects include", () => {
    const links = inventoryRelatedLinks("org-1", {
      active: "orders",
      include: ["vendors", "spare-forecast"],
    });
    expect(links.map((l) => l.id)).toEqual(["vendors", "spare-forecast"]);
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(inventoryRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
    expect(blob).not.toMatch(/demo/i);
  });
});

describe("inventorySetupSteps", () => {
  it("points setup at Workspace + Vendors / Orders / Spare Forecast", () => {
    const steps = inventorySetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["workspace", "vendors", "orders", "spare-forecast"]);
    expect(steps.find((s) => s.id === "vendors")?.href).toBe("/vendors?orgId=org-1");
    expect(steps.find((s) => s.id === "orders")?.href).toBe("/business?tab=orders&orgId=org-1");
    expect(steps.find((s) => s.id === "spare-forecast")?.href).toBe(
      "/build?tab=spare-forecast&orgId=org-1",
    );
  });
});

describe("inventoryNextActions", () => {
  it("gates on workspace when org is missing", () => {
    const actions = inventoryNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "vendors")).toBe(true);
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(true);
  });

  it("setup with org points at Workspace + Vendors / Orders / Spare Forecast", () => {
    const actions = inventoryNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.some((a) => a.id === "vendors")).toBe(true);
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at add-item + Vendors / Orders / Spare Forecast", () => {
    const actions = inventoryNextActions({
      orgId: "org-1",
      shell: "empty",
      itemCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["add-item", "vendors", "orders", "spare-forecast"]),
    );
    expect(actions[0]?.href).toBe("#inventory-add-item");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize low-stock / Orders without DEMO counts", () => {
    const actions = inventoryNextActions({
      orgId: "org-1",
      shell: "ready",
      itemCount: 4,
      lowStockCount: 2,
      outOfStockCount: 0,
    });
    expect(actions[0]?.id).toBe("reorder");
    expect(actions.some((a) => a.id === "orders")).toBe(true);
    expect(actions.some((a) => a.id === "vendors")).toBe(true);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(true);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });
});

describe("classifyInventoryShell", () => {
  it("classifies loading / error / setup / empty / ready without DEMO counts", () => {
    expect(classifyInventoryShell({ loading: true })).toBe("loading");
    expect(classifyInventoryShell({ loading: false, orgId: null })).toBe("setup");
    expect(classifyInventoryShell({ loading: false, orgId: "o1", fetchFailed: true })).toBe("error");
    expect(
      classifyInventoryShell({
        loading: false,
        orgId: "o1",
        status: "setup_required",
      }),
    ).toBe("setup");
    expect(
      classifyInventoryShell({
        loading: false,
        orgId: "o1",
        status: "ready",
        itemCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyInventoryShell({
        loading: false,
        orgId: "o1",
        status: "ready",
        itemCount: 2,
      }),
    ).toBe("ready");
  });
});

describe("inventoryShellCopy + formatInventoryMetric", () => {
  it("refuses invented DEMO stock metrics in empty/setup copy", () => {
    for (const kind of ["empty", "setup", "error", "ready"] as const) {
      const copy = inventoryShellCopy(kind);
      expect(copy.title).not.toMatch(/\bDEMO\b/);
      expect(copy.description).toMatch(/never|empty|org-scoped|real|blank|invent/i);
    }
    expect(inventoryShellCopy("empty").description).toMatch(/never DEMO/i);
    expect(inventoryShellCopy("setup").description).toMatch(/pre-seeded|org-scoped/i);
  });

  it("formats real counts only and hides zeroed tiles", () => {
    expect(formatInventoryMetric(null, false)).toBe("…");
    expect(formatInventoryMetric(3, true)).toBe("3");
    expect(formatInventoryMetric(-1, true)).toBe("0");
    expect(formatInventoryMoney(0, true)).toBe("—");
    expect(formatInventoryMoney(12.5, true)).toBe("$12.5");
    expect(shouldShowInventorySummaryTiles(0)).toBe(false);
    expect(shouldShowInventorySummaryTiles(1)).toBe(true);
  });
});
