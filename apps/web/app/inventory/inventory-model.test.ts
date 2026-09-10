import { describe, expect, it } from "vitest";
import {
  filterVisibleInventoryItems,
  fmtQty,
  inventorySectionDescribe,
  parseInventoryTab,
  type InventoryTab,
} from "./inventory-model";
import type { InventoryItem } from "../../lib/inventory";

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, "id" | "name">): InventoryItem {
  return {
    category: "other",
    partNumber: null,
    vendor: null,
    unit: "each",
    quantity: 1,
    minQuantity: 0,
    unitCost: null,
    locationId: null,
    locationName: null,
    subsystem: null,
    notes: "",
    archived: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("inventory-model", () => {
  it("formats quantities without inventing stock", () => {
    expect(fmtQty(3)).toBe("3");
    expect(fmtQty(1.255)).toBe("1.26");
  });

  it("describes Stock / Locations / BOM exhaustively", () => {
    const tabs: InventoryTab[] = ["stock", "locations", "bom"];
    expect(tabs.map(inventorySectionDescribe)).toEqual([
      "On-hand quantities",
      "Shelves, bins, and carts",
      "Parts per mechanism",
    ]);
    expect(parseInventoryTab("stock")).toBe("stock");
    expect(parseInventoryTab("tabs")).toBeNull();
  });

  it("filters archived, low, spare, category, and search against real fields", () => {
    const items = [
      item({ id: "1", name: "NEO", category: "motor", quantity: 1, minQuantity: 2, vendor: "REV" }),
      item({ id: "2", name: "Belt", category: "hardware", isSpare: true, quantity: 8, minQuantity: 0 }),
      item({ id: "3", name: "Old motor", category: "motor", archived: true, quantity: 0, minQuantity: 0 }),
    ];
    expect(filterVisibleInventoryItems(items, {
      search: "",
      category: "all",
      lowOnly: false,
      sparesOnly: false,
      showArchived: false,
    }).map((row) => row.id)).toEqual(["1", "2"]);
    expect(filterVisibleInventoryItems(items, {
      search: "",
      category: "all",
      lowOnly: true,
      sparesOnly: false,
      showArchived: false,
    }).map((row) => row.id)).toEqual(["1"]);
    expect(filterVisibleInventoryItems(items, {
      search: "rev",
      category: "all",
      lowOnly: false,
      sparesOnly: false,
      showArchived: false,
    }).map((row) => row.id)).toEqual(["1"]);
    expect(filterVisibleInventoryItems(items, {
      search: "",
      category: "all",
      lowOnly: false,
      sparesOnly: true,
      showArchived: false,
    }).map((row) => row.id)).toEqual(["2"]);
  });
});
