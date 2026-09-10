import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Inventory (never DEMO stock metrics). */
export const INVENTORY_RELATED_LINKS = [
  { id: "vendors", label: "Vendors", kind: "path" as const, path: "/vendors" },
  { id: "orders", label: "Orders", kind: "business" as const, tab: "orders" },
  {
    id: "spare-forecast",
    label: "Spare Forecast",
    kind: "build" as const,
    tab: "spare-forecast",
  },
  { id: "inventory", label: "Inventory", kind: "path" as const, path: "/inventory" },
] as const;

export type InventoryRelatedId = (typeof INVENTORY_RELATED_LINKS)[number]["id"];

export type InventoryRelatedLink = {
  id: InventoryRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Vendors / Orders / Spare Forecast first. */
export const INVENTORY_RELATED_INCLUDE: InventoryRelatedId[] = [
  "vendors",
  "orders",
  "spare-forecast",
];

/**
 * Soft-UI cross-links from Inventory → Vendors / Orders / Spare Forecast.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function inventoryRelatedLinks(
  orgId?: string | null,
  options?: { active?: InventoryRelatedId; include?: InventoryRelatedId[] },
): InventoryRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return INVENTORY_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "business") {
      return { id: link.id, label: link.label, href: hubHref("/business", link.tab, orgId) };
    }
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type InventoryShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type InventoryNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type InventoryEmptyCopy = {
  kind: InventoryShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO stock metrics. */
export type InventorySetupStep = { id: string; label: string; detail: string; href: string };

export function inventorySetupSteps(orgId?: string | null): InventorySetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Inventory.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "vendors",
      label: "Open Vendors",
      detail: "Supplier contacts stay blank until you add them.",
      href: withOrgHref("/vendors", orgId),
    },
    {
      id: "orders",
      label: "Open Orders",
      detail: "Purchase orders stay empty until drafted.",
      href: hubHref("/business", "orders", orgId),
    },
    {
      id: "spare-forecast",
      label: "Open Spare Forecast",
      detail: "Exhaustion projections stay blank until spare bins exist.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
  ];
}

/** Real inventory counts only — never invent DEMO stock totals. */
export function formatInventoryMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** On-hand value from real unit costs only — never invent DEMO dollars. */
export function formatInventoryMoney(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Hide zeroed summary tiles when no items exist — avoids DEMO counters. */
export function shouldShowInventorySummaryTiles(itemCount: number): boolean {
  return itemCount > 0;
}

/** Classify Inventory Soft-UI shell — never invents DEMO stock metrics. */
export function classifyInventoryShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  orgId?: string | null;
  itemCount?: number;
}): InventoryShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.itemCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO stock metrics. */
export function inventoryShellCopy(kind: InventoryShellKind): InventoryEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Inventory…",
        description:
          "Checking which team you are on and real parts stock.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Inventory",
        description:
          "A network or server issue blocked parts stock. Retry, or open Vendors / Orders / Spare Forecast while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Select a team before tracking real parts.",
      };
    case "empty":
      return {
        kind,
        badge: "No parts yet",
        title: "Add a part before tracking stock",
        description:
          "Quantities, reorder thresholds, and on-hand value stay blank until you add a real item. Cross-check Vendors, Orders, and Spare Forecast.",
      };
    default:
      return {
        kind: "ready",
        title: "Parts stock & BOM",
        description:
          "On-hand counts and reorder flags use only logged inventory rows.",
      };
  }
}

/**
 * Soft-UI next actions for Inventory empty/setup shells.
 * Points at Vendors / Orders / Spare Forecast — never invents DEMO stock metrics.
 */
export function inventoryNextActions(input: {
  orgId?: string | null;
  shell: InventoryShellKind;
  itemCount?: number;
  lowStockCount?: number;
  outOfStockCount?: number;
}): InventoryNextAction[] {
  const orgId = input.orgId ?? null;
  const itemCount = input.itemCount ?? 0;
  const lowStockCount = input.lowStockCount ?? 0;
  const outOfStockCount = input.outOfStockCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of inventorySetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(inventorySetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Inventory",
        detail: "Reload real parts stock.",
        href: withOrgHref("/inventory", orgId),
        primary: true,
      },
      {
        id: "vendors",
        label: "Open Vendors",
        detail: "Supplier contacts stay available while inventory reloads.",
        href: withOrgHref("/vendors", orgId),
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "Existing purchase orders stay available while inventory reloads.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Spare projections stay available while inventory reloads.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
    ];
  }

  if (input.shell === "empty" || itemCount === 0) {
    return [
      {
        id: "add-item",
        label: "Add a part",
        detail: "Name, category, and quantity stay blank until you enter a real item.",
        href: "#inventory-add-item",
        primary: true,
      },
      {
        id: "vendors",
        label: "Open Vendors",
        detail: "Log suppliers before you reorder.",
        href: withOrgHref("/vendors", orgId),
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "Purchase orders stay blank until you draft them.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Once spare-category bins exist, project exhaustion from real stock.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
    ].slice(0, 4);
  }

  const actions: InventoryNextAction[] = [];

  if (outOfStockCount > 0) {
    actions.push({
      id: "restock",
      label: "Restock out-of-stock parts",
      detail: `${outOfStockCount} part${outOfStockCount === 1 ? "" : "s"} at zero — draft real Orders.`,
      href: "#inventory-stock",
      primary: true,
    });
  } else if (lowStockCount > 0) {
    actions.push({
      id: "reorder",
      label: "Review low-stock parts",
      detail: `${lowStockCount} part${lowStockCount === 1 ? "" : "s"} at or below reorder — open Orders or Spare Forecast.`,
      href: "#inventory-stock",
      primary: true,
    });
  } else {
    actions.push({
      id: "stock",
      label: "Review parts stock",
      detail: `${itemCount} real item${itemCount === 1 ? "" : "s"} — keep quantities and locations current.`,
      href: "#inventory-stock",
      primary: true,
    });
  }

  actions.push(
    {
      id: "orders",
      label: "Open Orders",
      detail: "Turn low-stock and BOM shortfalls into season purchase orders.",
      href: hubHref("/business", "orders", orgId),
    },
    {
      id: "vendors",
      label: "Open Vendors",
      detail: "Match restocks to preferred suppliers and lead times.",
      href: withOrgHref("/vendors", orgId),
    },
    {
      id: "spare-forecast",
      label: "Open Spare Forecast",
      detail: "Project which spare-category bins will exhaust before the season ends.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
  );

  return actions.slice(0, 5);
}
