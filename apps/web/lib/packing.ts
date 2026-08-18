// Competition Packing Lists — framework-free domain logic shared by the API
// route, the client UI, and unit tests. No server or React imports belong here.

/** Standard FRC competition load-out, category → items (label, qty). */
export const PACKING_TEMPLATE: Array<{ category: string; items: Array<{ label: string; quantity: number }> }> = [
  {
    category: "Robot & Spares",
    items: [
      { label: "Robot (in cart or crate)", quantity: 1 },
      { label: "Bumpers — separate red and blue sets (not reversible)", quantity: 2 },
      { label: "White 3.5 in bumper numerals (0.25 in stroke; ≥3 sides ~90° apart)", quantity: 1 },
      { label: "Solid-core bumper foam spare (not hollow pool noodles)", quantity: 1 },
      { label: "Bumper backer through-bolts (not wood screws)", quantity: 1 },
      { label: "Bumper quick-release pins / RivNuts (easily removable for inspection)", quantity: 1 },
      { label: "Bumper staples 1/2 in or 3/4 in + shears to trim excess fabric", quantity: 1 },
      { label: "Spare bumper backer / brackets", quantity: 2 },
      { label: "Pneumatic vent plug labeled and reachable (inspectors fail a hidden plug)", quantity: 1 },
      { label: "Pressure switch spare (wired to PCM/PH; n/a if no pneumatics)", quantity: 1 },
      { label: "Pneumatic rating card (working ≥ 70 psi / stored ≥ 125 psi; R801/R802)", quantity: 1 },
      { label: "1/4 in OD pneumatic tubing spare (docs if not KOP)", quantity: 1 },
      { label: "1/8 in NPT solenoid spare (not 1/4 NPT; outputs not teed)", quantity: 1 },
      { label: "Stored + working gauges visible both sides of the regulator (R810)", quantity: 1 },
      { label: "Relieving regulator spare (≤ 60 psi working; not a non-relieving valve)", quantity: 1 },
      { label: "Spare parts kit (printed + machined spares)", quantity: 1 },
      { label: "Spare wheels / tread", quantity: 4 },
      { label: "Spare belts, chain, and fasteners", quantity: 1 },
      { label: "Spare intake timing belts (shock-load / sheared teeth)", quantity: 4 },
      { label: "Spare intake rollers / beater bar (outside-frame hits)", quantity: 2 },
      { label: "Spare high-contact shafts / plates (defense bends will not press straight)", quantity: 2 },
      { label: "Spare MAXSwerve Vortex shafts / MK4i belts", quantity: 4 },
      { label: "Non-WCP load-rated zip ties (WCP 10/14 in snapped under load)", quantity: 1 },
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
      { label: "Battery-box foam so the pack cannot rattle (wears through heat shrink)", quantity: 1 },
      { label: "Keep battery vents clear while charging (R601 — no strap/crate over the vent)", quantity: 1 },
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
      { label: "Microfiber cloths for vision lenses", quantity: 4 },
      { label: "Loctite 425 (plastic-safe near polycarb — not 242/243)", quantity: 1 },
      { label: "Loctite 242/243 for metal fasteners (not near polycarb)", quantity: 1 },
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
      { label: "Passive PoE injector / modified ethernet for VH-109 v1.0 RIO port (not VRM/RPM)", quantity: 1 },
      { label: "Spare robot signal light (RSL port; visible from 36 in)", quantity: 1 },
      { label: "Spare PDH (high-strand 4 AWG melted hubs)", quantity: 1 },
      { label: "Spare main breaker (replace after a trip)", quantity: 2 },
      { label: "3D-printed main breaker cover", quantity: 1 },
      { label: "Spare motor controllers", quantity: 2 },
      { label: "Spare Kraken power-connector screws", quantity: 8 },
      { label: "Kraken torque driver (0.9 N·m power spec; 1.2 N·m holds better — 0.6 N·m CAN)", quantity: 1 },
      { label: "Zip ties to lock seated Anderson halves (half-seated drops under impact)", quantity: 1 },
      { label: "USB cables + programming kit", quantity: 1 },
      { label: "Ferrules for Weidmuller / screw terminals", quantity: 1 },
      { label: "Heat shrink for exposed battery terminals", quantity: 1 },
      { label: "Hot glue for CAN / USB / CANivore connectors", quantity: 1 },
      { label: "Shielded CANivore USB-C (stock cable; no unshielded log-drive dongle)", quantity: 1 },
      { label: "Endurance-class SD card for RIO logging (fresh per event)", quantity: 2 },
      { label: "Wire stripper — Wago 221 gauge (11 mm); NEO phase is too fat for 221s", quantity: 1 },
      { label: "NEO encoder/hall JST spares + strain-relief (hot-glue connectors)", quantity: 4 },
      { label: "ESD kit — copper tape / foil, chassis-bond jumper (not to power), grounding drag", quantity: 1 },
      { label: "Tape unused PDH / RIO / VRM ports (conductive debris reboots radios)", quantity: 1 },
      { label: "PDH ATM 15A fuses + one 20A for PCM/PH (or 20A breaker; not a yellow fuse farm)", quantity: 1 },
      { label: "Keep PCM/PH ≥ 6 in from the radio (RF compressor faults)", quantity: 1 },
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
      { label: "Tape / caps for accidental USB controller buttons", quantity: 1 },
      { label: "NI Game Tools 26.0+ installer USB (field laptop; DS 26.0 / RIO 2026_v1.2)", quantity: 1 },
      { label: "Reconfigure radio for home after the kiosk (2.4 GHz is a web-UI checkbox, not DIP 3)", quantity: 1 },
      { label: "No spare radio on the DS cart (unauthorized wireless)", quantity: 1 },
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
      { label: "Operator console size card (under 60×16×78 in)", quantity: 1 },
      { label: "Tape measure for starting volume (110 in perimeter / 30 in tall) and 12 in extension", quantity: 1 },
      { label: "Bumper-gap card (1.25 in small gaps / 5 in from corners on one large gap)", quantity: 1 },
      { label: "Bumper-extension gauge (stack ≤ 4.25 in from perimeter; R403)", quantity: 1 },
      { label: "Hard-parts gauge (≤ 1.5 in from perimeter, padding ≥ 2 in past wood; R404)", quantity: 1 },
      { label: "Backing height card (≥ 4.25 in tall supporting all padding; R402)", quantity: 1 },
      { label: "Corner-fill foam (2 in diagonal uncompressed; R406)", quantity: 1 },
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
