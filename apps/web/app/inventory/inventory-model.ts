import { isLowStock, type InventoryItem, type InventoryView } from "../../lib/inventory";

export type ActionBody = Record<string, unknown> & { action: string; orgId: string };
export type ReadyView = Extract<InventoryView, { status: "ready" }>;
export type InventoryTab = "stock" | "locations" | "bom";
export type RunFn = (body: ActionBody, key: string) => Promise<void>;

export const INVENTORY_ADD_HREF = "#inventory-add-item";

export const INVENTORY_SECTION_ITEMS: { id: InventoryTab; label: string }[] = [
  { id: "stock", label: "Stock" },
  { id: "locations", label: "Locations" },
  { id: "bom", label: "BOM" },
];

export function fmtQty(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function inventorySectionDescribe(id: InventoryTab): string {
  switch (id) {
    case "stock":
      return "On-hand quantities";
    case "locations":
      return "Shelves, bins, and carts";
    case "bom":
      return "Parts per mechanism";
    default: {
      const _never: never = id;
      return _never;
    }
  }
}

export function parseInventoryTab(id: string): InventoryTab | null {
  switch (id) {
    case "stock":
    case "locations":
    case "bom":
      return id;
    default:
      return null;
  }
}

export function inventoryOrgId(view: InventoryView | null): string | null {
  if (view?.status === "ready" || view?.status === "setup_required") {
    return view.context.orgId;
  }
  return null;
}

export function filterVisibleInventoryItems(
  items: InventoryItem[],
  opts: {
    search: string;
    category: string;
    lowOnly: boolean;
    sparesOnly: boolean;
    showArchived: boolean;
  },
): InventoryItem[] {
  const query = opts.search.trim().toLowerCase();
  return items.filter((item) => {
    if (!opts.showArchived && item.archived) return false;
    if (opts.lowOnly && !isLowStock(item)) return false;
    if (opts.sparesOnly && !item.isSpare) return false;
    if (opts.category !== "all" && item.category !== opts.category) return false;
    if (query) {
      const hay =
        `${item.name} ${item.partNumber ?? ""} ${item.vendor ?? ""} ${item.subsystem ?? ""} ${item.locationName ?? ""}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}
