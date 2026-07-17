// Inventory & Bill-of-Materials — framework-free domain logic shared by the API
// route, the client UI, and unit tests. No server or React imports belong here.

export const INVENTORY_CATEGORIES = [
  "motor",
  "gearbox",
  "wheel",
  "electronics",
  "pneumatics",
  "hardware",
  "raw_stock",
  "tool",
  "battery",
  "spare",
  "other",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const LOCATION_KINDS = ["shelf", "bin", "cart", "pit", "trailer", "other"] as const;
export type LocationKind = (typeof LOCATION_KINDS)[number];

export const TX_REASONS = ["received", "used", "adjust", "return", "damaged"] as const;
export type TxReason = (typeof TX_REASONS)[number];

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  motor: "Motor",
  gearbox: "Gearbox",
  wheel: "Wheel / tread",
  electronics: "Electronics",
  pneumatics: "Pneumatics",
  hardware: "Hardware / fasteners",
  raw_stock: "Raw stock",
  tool: "Tool",
  battery: "Battery",
  spare: "Spare",
  other: "Other",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category as InventoryCategory] ?? category;
}

// ---------------------------------------------------------------------------
// Row + view types (camelCase; the API casts numeric columns to JS numbers).
// ---------------------------------------------------------------------------

export type InventoryLocation = {
  id: string;
  name: string;
  kind: LocationKind;
  notes: string;
  itemCount: number;
};

export type InventoryItem = {
  id: string;
  name: string;
  category: InventoryCategory;
  partNumber: string | null;
  vendor: string | null;
  unit: string;
  quantity: number;
  minQuantity: number;
  unitCost: number | null;
  locationId: string | null;
  locationName: string | null;
  subsystem: string | null;
  notes: string;
  archived: boolean;
  updatedAt: string;
};

export type InventoryTransaction = {
  id: string;
  itemId: string;
  itemName: string | null;
  delta: number;
  reason: TxReason;
  note: string;
  byName: string | null;
  createdAt: string;
};

export type BomEntry = {
  id: string;
  subsystem: string;
  itemId: string;
  quantityNeeded: number;
  notes: string;
};

export type InventoryContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
};

export type InventoryView =
  | {
      status: "ready";
      context: InventoryContext;
      items: InventoryItem[];
      locations: InventoryLocation[];
      transactions: InventoryTransaction[];
      bom: BomEntry[];
    }
  | { status: "setup_required"; context: InventoryContext; message: string };

// ---------------------------------------------------------------------------
// Derived metrics (pure, unit-tested).
// ---------------------------------------------------------------------------

/** A tracked item is "low" when it has a reorder threshold and is at or below it. */
export function isLowStock(item: Pick<InventoryItem, "quantity" | "minQuantity" | "archived">): boolean {
  return !item.archived && item.minQuantity > 0 && item.quantity <= item.minQuantity;
}

export function lowStockItems(items: InventoryItem[]): InventoryItem[] {
  return items.filter((item) => isLowStock(item));
}

/** Total valuation of on-hand, non-archived stock with a known unit cost. */
export function inventoryValue(items: InventoryItem[]): number {
  const total = items.reduce((sum, item) => {
    if (item.archived || item.unitCost == null) return sum;
    return sum + item.quantity * item.unitCost;
  }, 0);
  return Math.round(total * 100) / 100;
}

export type InventorySummary = {
  totalItems: number;
  lowStock: number;
  outOfStock: number;
  categories: number;
  value: number;
};

export function summarizeInventory(items: InventoryItem[]): InventorySummary {
  const active = items.filter((item) => !item.archived);
  return {
    totalItems: active.length,
    lowStock: active.filter((item) => isLowStock(item)).length,
    outOfStock: active.filter((item) => item.quantity <= 0).length,
    categories: new Set(active.map((item) => item.category)).size,
    value: inventoryValue(items),
  };
}

export type BomLine = {
  itemId: string;
  itemName: string;
  needed: number;
  onHand: number;
  short: number;
};
export type BomSubsystem = {
  subsystem: string;
  buildable: boolean;
  shortCount: number;
  lines: BomLine[];
};

/**
 * Group BOM entries by subsystem and compare needed vs on-hand. A subsystem is
 * "buildable" when every line has enough stock. Unknown/removed items read as 0.
 */
export function bomCoverage(entries: BomEntry[], items: InventoryItem[]): BomSubsystem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const bySubsystem = new Map<string, BomLine[]>();

  for (const entry of entries) {
    const item = byId.get(entry.itemId);
    const onHand = item && !item.archived ? item.quantity : 0;
    const line: BomLine = {
      itemId: entry.itemId,
      itemName: item?.name ?? "(removed item)",
      needed: entry.quantityNeeded,
      onHand,
      short: Math.max(0, entry.quantityNeeded - onHand),
    };
    const list = bySubsystem.get(entry.subsystem) ?? [];
    list.push(line);
    bySubsystem.set(entry.subsystem, list);
  }

  return [...bySubsystem.entries()]
    .map(([subsystem, lines]) => {
      const sorted = [...lines].sort((a, b) => a.itemName.localeCompare(b.itemName));
      const shortCount = sorted.filter((line) => line.short > 0).length;
      return { subsystem, lines: sorted, shortCount, buildable: shortCount === 0 };
    })
    .sort((a, b) => a.subsystem.localeCompare(b.subsystem));
}

// ---------------------------------------------------------------------------
// Action validation (mirrors lib/pit-operations.ts / awards parse pattern).
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function optionalUuid(value: unknown, label: string) {
  if (value == null || value === "") return null;
  return uuid(value, label);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  const text = requiredText(value, label, 40);
  if (!allowed.includes(text as T)) throw new Error(`Invalid ${label.toLowerCase()}`);
  return text as T;
}

/** Non-negative stock quantity. */
function quantity(value: unknown, label: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10_000_000) {
    throw new Error(`${label} must be between 0 and 10000000`);
  }
  return Math.round(number * 100) / 100;
}

function optionalCost(value: unknown) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 10_000_000) {
    throw new Error("Unit cost must be between 0 and 10000000");
  }
  return Math.round(number * 100) / 100;
}

/** Non-zero signed stock movement. */
function delta(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0 || Math.abs(number) > 10_000_000) {
    throw new Error("Enter a non-zero adjustment");
  }
  return Math.round(number * 100) / 100;
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

export type ItemPatch = {
  name?: string;
  category?: InventoryCategory;
  unit?: string;
  partNumber?: string | null;
  vendor?: string | null;
  minQuantity?: number;
  unitCost?: number | null;
  locationId?: string | null;
  subsystem?: string | null;
  notes?: string;
  archived?: boolean;
};

export type LocationPatch = { name?: string; kind?: LocationKind; notes?: string };

export type InventoryAction =
  | {
      action: "create_item";
      orgId: string;
      name: string;
      category: InventoryCategory;
      unit: string;
      partNumber: string | null;
      vendor: string | null;
      minQuantity: number;
      unitCost: number | null;
      locationId: string | null;
      subsystem: string | null;
      notes: string;
      initialQuantity: number;
    }
  | { action: "update_item"; orgId: string; id: string; patch: ItemPatch }
  | { action: "delete_item"; orgId: string; id: string }
  | { action: "adjust_stock"; orgId: string; itemId: string; delta: number; reason: TxReason; note: string }
  | { action: "create_location"; orgId: string; name: string; kind: LocationKind; notes: string }
  | { action: "update_location"; orgId: string; id: string; patch: LocationPatch }
  | { action: "delete_location"; orgId: string; id: string }
  | { action: "set_bom"; orgId: string; subsystem: string; itemId: string; quantityNeeded: number; notes: string }
  | { action: "delete_bom"; orgId: string; id: string };

export function parseInventoryAction(input: unknown): InventoryAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid inventory action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_item":
      return {
        action,
        orgId,
        name: requiredText(body.name, "Item name", 160),
        category: has(body, "category") ? enumValue(body.category, INVENTORY_CATEGORIES, "Category") : "other",
        unit: optionalText(body.unit, 24) ?? "each",
        partNumber: optionalText(body.partNumber, 80),
        vendor: optionalText(body.vendor, 120),
        minQuantity: has(body, "minQuantity") ? quantity(body.minQuantity, "Reorder threshold") : 0,
        unitCost: optionalCost(body.unitCost),
        locationId: optionalUuid(body.locationId, "Location"),
        subsystem: optionalText(body.subsystem, 80),
        notes: optionalText(body.notes, 2_000) ?? "",
        initialQuantity: has(body, "initialQuantity") ? quantity(body.initialQuantity, "Starting quantity") : 0,
      };

    case "update_item": {
      const patch: ItemPatch = {};
      if (has(body, "name")) patch.name = requiredText(body.name, "Item name", 160);
      if (has(body, "category")) patch.category = enumValue(body.category, INVENTORY_CATEGORIES, "Category");
      if (has(body, "unit")) patch.unit = optionalText(body.unit, 24) ?? "each";
      if (has(body, "partNumber")) patch.partNumber = optionalText(body.partNumber, 80);
      if (has(body, "vendor")) patch.vendor = optionalText(body.vendor, 120);
      if (has(body, "minQuantity")) patch.minQuantity = quantity(body.minQuantity, "Reorder threshold");
      if (has(body, "unitCost")) patch.unitCost = optionalCost(body.unitCost);
      if (has(body, "locationId")) patch.locationId = optionalUuid(body.locationId, "Location");
      if (has(body, "subsystem")) patch.subsystem = optionalText(body.subsystem, 80);
      if (has(body, "notes")) patch.notes = optionalText(body.notes, 2_000) ?? "";
      if (has(body, "archived")) patch.archived = Boolean(body.archived);
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Item"), patch };
    }

    case "delete_item":
      return { action, orgId, id: uuid(body.id, "Item") };

    case "adjust_stock":
      return {
        action,
        orgId,
        itemId: uuid(body.itemId, "Item"),
        delta: delta(body.delta),
        reason: has(body, "reason") ? enumValue(body.reason, TX_REASONS, "Reason") : "adjust",
        note: optionalText(body.note, 500) ?? "",
      };

    case "create_location":
      return {
        action,
        orgId,
        name: requiredText(body.name, "Location name", 80),
        kind: has(body, "kind") ? enumValue(body.kind, LOCATION_KINDS, "Location kind") : "shelf",
        notes: optionalText(body.notes, 500) ?? "",
      };

    case "update_location": {
      const patch: LocationPatch = {};
      if (has(body, "name")) patch.name = requiredText(body.name, "Location name", 80);
      if (has(body, "kind")) patch.kind = enumValue(body.kind, LOCATION_KINDS, "Location kind");
      if (has(body, "notes")) patch.notes = optionalText(body.notes, 500) ?? "";
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Location"), patch };
    }

    case "delete_location":
      return { action, orgId, id: uuid(body.id, "Location") };

    case "set_bom": {
      const quantityNeeded = Number(body.quantityNeeded);
      if (!Number.isFinite(quantityNeeded) || quantityNeeded <= 0 || quantityNeeded > 10_000_000) {
        throw new Error("Quantity needed must be greater than 0");
      }
      return {
        action,
        orgId,
        subsystem: requiredText(body.subsystem, "Subsystem", 80),
        itemId: uuid(body.itemId, "Item"),
        quantityNeeded: Math.round(quantityNeeded * 100) / 100,
        notes: optionalText(body.notes, 500) ?? "",
      };
    }

    case "delete_bom":
      return { action, orgId, id: uuid(body.id, "BOM entry") };

    default:
      throw new Error("Unsupported inventory action");
  }
}
