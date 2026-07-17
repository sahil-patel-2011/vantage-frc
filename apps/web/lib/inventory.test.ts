import { describe, expect, it } from "vitest";
import {
  bomCoverage,
  categoryLabel,
  inventoryValue,
  isLowStock,
  lowStockItems,
  parseInventoryAction,
  summarizeInventory,
  type BomEntry,
  type InventoryItem,
} from "./inventory";

const ORG = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const ITEM2 = "33333333-3333-4333-8333-333333333333";

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: ITEM,
    name: "NEO",
    category: "motor",
    partNumber: null,
    vendor: null,
    unit: "each",
    quantity: 4,
    minQuantity: 0,
    unitCost: null,
    locationId: null,
    locationName: null,
    subsystem: null,
    notes: "",
    archived: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("categoryLabel", () => {
  it("maps known categories and falls back", () => {
    expect(categoryLabel("raw_stock")).toBe("Raw stock");
    expect(categoryLabel("mystery")).toBe("mystery");
  });
});

describe("isLowStock / lowStockItems", () => {
  it("flags items at or below a positive threshold", () => {
    expect(isLowStock(item({ quantity: 2, minQuantity: 3 }))).toBe(true);
    expect(isLowStock(item({ quantity: 3, minQuantity: 3 }))).toBe(true);
    expect(isLowStock(item({ quantity: 4, minQuantity: 3 }))).toBe(false);
  });
  it("ignores items without a threshold and archived items", () => {
    expect(isLowStock(item({ quantity: 0, minQuantity: 0 }))).toBe(false);
    expect(isLowStock(item({ quantity: 0, minQuantity: 5, archived: true }))).toBe(false);
    expect(lowStockItems([item({ quantity: 1, minQuantity: 2 }), item({ quantity: 9, minQuantity: 2 })])).toHaveLength(1);
  });
});

describe("inventoryValue / summarizeInventory", () => {
  it("values only non-archived items with a known cost", () => {
    const items = [
      item({ quantity: 4, unitCost: 30 }),
      item({ quantity: 10, unitCost: null }),
      item({ quantity: 100, unitCost: 5, archived: true }),
    ];
    expect(inventoryValue(items)).toBe(120);
  });
  it("summarizes counts, low stock, and out of stock", () => {
    const summary = summarizeInventory([
      item({ id: ITEM, category: "motor", quantity: 0, minQuantity: 2 }),
      item({ id: ITEM2, category: "gearbox", quantity: 5, minQuantity: 1, unitCost: 40 }),
      item({ category: "spare", archived: true }),
    ]);
    expect(summary.totalItems).toBe(2);
    expect(summary.lowStock).toBe(1);
    expect(summary.outOfStock).toBe(1);
    expect(summary.categories).toBe(2);
    expect(summary.value).toBe(200);
  });
});

describe("bomCoverage", () => {
  const items = [item({ id: ITEM, name: "NEO", quantity: 2 }), item({ id: ITEM2, name: "Falcon", quantity: 6 })];
  const entries: BomEntry[] = [
    { id: "b1", subsystem: "Drivetrain", itemId: ITEM, quantityNeeded: 4, notes: "" },
    { id: "b2", subsystem: "Drivetrain", itemId: ITEM2, quantityNeeded: 4, notes: "" },
  ];
  it("computes shortfalls and buildability per subsystem", () => {
    const [drivetrain] = bomCoverage(entries, items);
    expect(drivetrain.subsystem).toBe("Drivetrain");
    expect(drivetrain.buildable).toBe(false);
    expect(drivetrain.shortCount).toBe(1);
    const neo = drivetrain.lines.find((line) => line.itemId === ITEM)!;
    expect(neo.short).toBe(2); // need 4, have 2
    const falcon = drivetrain.lines.find((line) => line.itemId === ITEM2)!;
    expect(falcon.short).toBe(0); // need 4, have 6
  });
  it("treats missing/removed items as zero on hand", () => {
    const [sub] = bomCoverage([{ id: "b3", subsystem: "Arm", itemId: "44444444-4444-4444-8444-444444444444", quantityNeeded: 1, notes: "" }], items);
    expect(sub.lines[0]!.onHand).toBe(0);
    expect(sub.buildable).toBe(false);
  });
});

describe("parseInventoryAction", () => {
  it("creates an item with defaults", () => {
    const action = parseInventoryAction({ action: "create_item", orgId: ORG, name: "NEO Vortex" });
    expect(action).toMatchObject({ action: "create_item", category: "other", unit: "each", minQuantity: 0, initialQuantity: 0 });
  });
  it("rejects a bad category and blank name", () => {
    expect(() => parseInventoryAction({ action: "create_item", orgId: ORG, name: "x", category: "rocket" })).toThrow(/Invalid category/);
    expect(() => parseInventoryAction({ action: "create_item", orgId: ORG, name: "  " })).toThrow(/required/);
  });
  it("requires a non-zero stock adjustment and valid reason", () => {
    expect(() => parseInventoryAction({ action: "adjust_stock", orgId: ORG, itemId: ITEM, delta: 0 })).toThrow(/non-zero/);
    const ok = parseInventoryAction({ action: "adjust_stock", orgId: ORG, itemId: ITEM, delta: -3, reason: "used" });
    expect(ok).toMatchObject({ action: "adjust_stock", delta: -3, reason: "used" });
  });
  it("builds a sparse item patch and allows clearing nullable fields", () => {
    const action = parseInventoryAction({ action: "update_item", orgId: ORG, id: ITEM, vendor: null, minQuantity: 5 });
    expect(action).toMatchObject({ action: "update_item", patch: { vendor: null, minQuantity: 5 } });
    if (action.action === "update_item") expect(action.patch.name).toBeUndefined();
  });
  it("rejects empty update patches and non-positive BOM quantities", () => {
    expect(() => parseInventoryAction({ action: "update_item", orgId: ORG, id: ITEM })).toThrow(/No changes/);
    expect(() => parseInventoryAction({ action: "set_bom", orgId: ORG, subsystem: "Arm", itemId: ITEM, quantityNeeded: 0 })).toThrow(/greater than 0/);
  });
});
