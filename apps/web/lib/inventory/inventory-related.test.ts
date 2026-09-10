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
import { expectPlainCopy } from "../ui/copy-assertions";

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
  it("keeps Choose your team; Vendors / Orders / Spare Forecast live on the related strip", () => {
    const steps = inventorySetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["workspace"]);
    expect(steps[0]?.href).toBe("/workspace?orgId=org-1");
    expect(steps.every((s) => !/\bDEMO\b/.test(s.label))).toBe(true);
  });

  it("no-org setup is only Choose your team", () => {
    expect(inventorySetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });
});

describe("inventoryNextActions", () => {
  it("gates on workspace when org is missing and does not repeat the related strip", () => {
    const actions = inventoryNextActions({ orgId: null, shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.some((a) => a.id === "vendors")).toBe(false);
    expect(actions.some((a) => a.id === "orders")).toBe(false);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(false);
  });

  it("setup with org is only Choose your team", () => {
    const actions = inventoryNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(["workspace"]);
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("points empty boards at add-item only", () => {
    const actions = inventoryNextActions({
      orgId: "org-1",
      shell: "empty",
      itemCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(["add-item"]);
    expect(actions[0]?.href).toBe("#inventory-add-item");
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("ready boards prioritize low-stock without repeating the related strip", () => {
    const actions = inventoryNextActions({
      orgId: "org-1",
      shell: "ready",
      itemCount: 4,
      lowStockCount: 2,
      outOfStockCount: 0,
    });
    expect(actions.map((a) => a.id)).toEqual(["reorder"]);
    expect(actions.some((a) => a.id === "orders")).toBe(false);
    expect(actions.some((a) => a.id === "vendors")).toBe(false);
    expect(actions.some((a) => a.id === "spare-forecast")).toBe(false);
    expect(actions.every((a) => !a.href.toLowerCase().includes("demo"))).toBe(true);
  });

  it("does not repeat header related-strip destinations as next actions", () => {
    const related = new Set(
      inventoryRelatedLinks("org-1", { include: [...INVENTORY_RELATED_INCLUDE] }).map(
        (link) => link.href,
      ),
    );
    for (const shell of ["empty", "setup", "error", "ready"] as const) {
      const actions = inventoryNextActions({
        orgId: "org-1",
        shell,
        itemCount: 4,
        lowStockCount: 2,
        outOfStockCount: 0,
      });
      expect(actions.every((action) => !related.has(action.href))).toBe(true);
    }
    const noOrg = inventoryNextActions({ orgId: null, shell: "setup" });
    const relatedNoOrg = new Set(
      inventoryRelatedLinks(null, { include: [...INVENTORY_RELATED_INCLUDE] }).map((link) => link.href),
    );
    expect(noOrg.every((action) => !relatedNoOrg.has(action.href))).toBe(true);
    expect(noOrg.some((action) => action.id === "workspace")).toBe(true);
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
      expectPlainCopy(copy.description);
    }
    expectPlainCopy(inventoryShellCopy("empty").description);
    expectPlainCopy(inventoryShellCopy("setup").description);
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
