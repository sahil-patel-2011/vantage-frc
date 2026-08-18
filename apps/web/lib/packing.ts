// Competition Packing Lists — framework-free domain logic shared by the API
// route, the client UI, and unit tests. No server or React imports belong here.

/** Standard FRC competition load-out, category → items (label, qty). */
export const PACKING_TEMPLATE: Array<{ category: string; items: Array<{ label: string; quantity: number }> }> = [
  {
    category: "Robot & Spares",
    items: [
      { label: "Robot (in cart or crate)", quantity: 1 },
      { label: "Bumpers — red and blue sets", quantity: 2 },
      { label: "Spare parts kit (printed + machined spares)", quantity: 1 },
      { label: "Spare wheels / tread", quantity: 4 },
      { label: "Spare belts, chain, and fasteners", quantity: 1 },
      { label: "Spare MAXSwerve Vortex shafts / MK4i belts", quantity: 4 },
    ],
  },
  {
    category: "Batteries & Power",
    items: [
      { label: "Competition batteries (charged)", quantity: 6 },
      { label: "Battery chargers", quantity: 2 },
      { label: "Battery cart / rack", quantity: 1 },
      { label: "Battery beak / voltmeter", quantity: 1 },
      { label: "Spare battery strap with metal buckle (not zip ties)", quantity: 2 },
      { label: "Power strips and extension cords", quantity: 2 },
    ],
  },
  {
    category: "Tools & Pit",
    items: [
      { label: "Rolling toolbox", quantity: 1 },
      { label: "Cordless drill / driver set", quantity: 2 },
      { label: "Hex key + socket sets", quantity: 2 },
      { label: "Zip ties, tape (electrical, gaffer)", quantity: 1 },
      { label: "Pit banner / signage", quantity: 1 },
      { label: "Pit tables and stools", quantity: 2 },
    ],
  },
  {
    category: "Electronics & Drive Station",
    items: [
      { label: "Driver station laptop (charged)", quantity: 1 },
      { label: "Ethernet cables", quantity: 3 },
      { label: "Joysticks / controllers + spares", quantity: 3 },
      { label: "Spare radio and roboRIO", quantity: 1 },
      { label: "Spare main breaker (replace after a trip)", quantity: 2 },
      { label: "Spare motor controllers", quantity: 2 },
      { label: "USB cables + programming kit", quantity: 1 },
    ],
  },
  {
    category: "Driver Station field kit",
    items: [
      { label: "Hook-and-loop for field DS shelf", quantity: 1 },
      { label: "Ethernet pigtail / USB-Ethernet dongle", quantity: 1 },
      { label: "Long ethernet tether (practice field / pit)", quantity: 1 },
      { label: "Long USB extensions for gamepads", quantity: 2 },
      { label: "Laptop charger for the player station", quantity: 1 },
      { label: "Cable strain-relief (tape / clips) for ethernet + USB", quantity: 1 },
    ],
  },
  {
    category: "Eliminations cart",
    items: [
      { label: "Field-side tool pouch (hex, cutters, tape, zip ties)", quantity: 1 },
      { label: "Eliminations spare battery pair", quantity: 2 },
      { label: "Eliminations fastener / zip-tie bag", quantity: 1 },
      { label: "Ethernet + radio spare in one pouch", quantity: 1 },
      { label: "Alliance-partner help kit (metric hex, 1/4-20, zip ties)", quantity: 1 },
    ],
  },
  {
    category: "Inspection binder",
    items: [
      { label: "Printed Bill of Materials (part, qty, price, supplier)", quantity: 1 },
      { label: "Printed robot inspection checklist", quantity: 1 },
      { label: "Current game manual / team updates printout", quantity: 1 },
      { label: "USB / printed CAD packet for inspector questions", quantity: 1 },
    ],
  },
  {
    category: "Team & Safety",
    items: [
      { label: "Safety glasses (team + guests)", quantity: 20 },
      { label: "First aid kit", quantity: 1 },
      { label: "Team roster and consent forms", quantity: 1 },
      { label: "Scouting tablets / clipboards", quantity: 6 },
      { label: "Water and snacks", quantity: 1 },
    ],
  },
];

export type PackingItem = {
  id: string;
  listId: string;
  category: string;
  label: string;
  quantity: number;
  packed: boolean;
  packedByName: string | null;
  packedAt: string | null;
  sortOrder: number;
};

export type PackingRequestStatus = "pending" | "accepted" | "dismissed";

/** CD packing-form row: name + what to pack. Lead accepts onto the master list. */
export type PackingRequest = {
  id: string;
  listId: string;
  category: string;
  label: string;
  quantity: number;
  note: string;
  requestedBy: string;
  requestedName: string;
  status: PackingRequestStatus;
  createdAt: string;
};

export type PackingList = {
  id: string;
  title: string;
  eventKey: string | null;
  createdBy: string;
  createdByName: string | null;
  updatedAt: string;
  items: PackingItem[];
  requests: PackingRequest[];
  canManageMaster: boolean;
};

export type PackingContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  eventKey: string | null;
};

export type PackingView =
  | { status: "ready"; context: PackingContext; lists: PackingList[] }
  | { status: "setup_required"; context: PackingContext; message: string };

// ---------------------------------------------------------------------------
// Derived metrics (pure, unit-tested).
// ---------------------------------------------------------------------------

export type PackProgress = { total: number; packed: number; percent: number; done: boolean };

export function packProgress(items: PackingItem[]): PackProgress {
  const total = items.length;
  const packed = items.filter((item) => item.packed).length;
  return {
    total,
    packed,
    percent: total ? Math.round((packed / total) * 100) : 0,
    done: total > 0 && packed === total,
  };
}

/** Group items by category, template categories first, in sort order. */
export function groupPacking(items: PackingItem[]): Array<{ category: string; items: PackingItem[] }> {
  const order = new Map(PACKING_TEMPLATE.map((entry, index) => [entry.category, index]));
  const byCategory = new Map<string, PackingItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  return [...byCategory.entries()]
    .map(([category, list]) => ({
      category,
      items: [...list].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => (order.get(a.category) ?? 99) - (order.get(b.category) ?? 99) || a.category.localeCompare(b.category));
}

/** Packing lead = list creator or owner/admin — they alone promote requests onto the master list. */
export function canManagePackingMaster(role: string | null | undefined, listCreatedBy: string, userId: string): boolean {
  return role === "owner" || role === "admin" || (Boolean(listCreatedBy) && listCreatedBy === userId);
}

export function canDismissPackingRequest(
  role: string | null | undefined,
  listCreatedBy: string,
  userId: string,
  requestedBy: string,
): boolean {
  return canManagePackingMaster(role, listCreatedBy, userId) || requestedBy === userId;
}

export function pendingPackingRequests(requests: PackingRequest[]): PackingRequest[] {
  return requests
    .filter((row) => row.status === "pending")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// ---------------------------------------------------------------------------
// Action validation (mirrors the other module parse patterns).
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

export type PackingAction =
  | { action: "create_list"; orgId: string; title: string; eventKey: string | null; seedTemplate: boolean }
  | { action: "delete_list"; orgId: string; id: string }
  | { action: "reset_list"; orgId: string; id: string }
  | { action: "add_item"; orgId: string; listId: string; category: string; label: string; quantity: number }
  | { action: "request_item"; orgId: string; listId: string; category: string; label: string; quantity: number; note: string | null }
  | { action: "accept_request"; orgId: string; id: string }
  | { action: "dismiss_request"; orgId: string; id: string }
  | { action: "toggle_item"; orgId: string; id: string; packed: boolean }
  | { action: "delete_item"; orgId: string; id: string };

export function parsePackingAction(input: unknown): PackingAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid packing action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_list":
      return {
        action,
        orgId,
        title: requiredText(body.title, "List title", 120),
        eventKey: optionalText(body.eventKey, 80),
        seedTemplate: body.seedTemplate !== false,
      };

    case "delete_list":
    case "reset_list":
      return { action, orgId, id: uuid(body.id, "List") };

    case "add_item": {
      const quantity = body.quantity == null || body.quantity === "" ? 1 : Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
        throw new Error("Quantity must be a whole number between 1 and 10000");
      }
      return {
        action,
        orgId,
        listId: uuid(body.listId, "List"),
        category: optionalText(body.category, 80) ?? "Other",
        label: requiredText(body.label, "Item", 200),
        quantity,
      };
    }

    case "request_item": {
      const quantity = body.quantity == null || body.quantity === "" ? 1 : Number(body.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
        throw new Error("Quantity must be a whole number between 1 and 10000");
      }
      return {
        action,
        orgId,
        listId: uuid(body.listId, "List"),
        category: optionalText(body.category, 80) ?? "Other",
        label: requiredText(body.label, "Item", 200),
        quantity,
        note: optionalText(body.note, 400),
      };
    }

    case "accept_request":
    case "dismiss_request":
      return { action, orgId, id: uuid(body.id, "Request") };

    case "toggle_item":
      return { action, orgId, id: uuid(body.id, "Item"), packed: Boolean(body.packed) };

    case "delete_item":
      return { action, orgId, id: uuid(body.id, "Item") };

    default:
      throw new Error("Unsupported packing action");
  }
}
