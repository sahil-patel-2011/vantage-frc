import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Vendor Lead Times (never DEMO reorder metrics). */
export const VENDOR_LEAD_TIMES_RELATED_LINKS = [
  { id: "orders", label: "Orders", kind: "business" as const, tab: "orders" },
  { id: "spare-forecast", label: "Spare Forecast", kind: "build" as const, tab: "spare-forecast" },
  { id: "vendors", label: "Vendors", kind: "path" as const, path: "/vendors" },
  { id: "build-burndown", label: "Build burndown", kind: "build" as const, tab: "build-burndown" },
  { id: "inventory", label: "Inventory", kind: "path" as const, path: "/inventory" },
] as const;

export type VendorLeadTimesRelatedId = (typeof VENDOR_LEAD_TIMES_RELATED_LINKS)[number]["id"];

export type VendorLeadTimesRelatedLink = {
  id: VendorLeadTimesRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Orders / Spare Forecast / Vendors first. */
export const VENDOR_LEAD_TIMES_RELATED_INCLUDE: VendorLeadTimesRelatedId[] = [
  "orders",
  "spare-forecast",
  "vendors",
];

/**
 * Soft-UI cross-links from Vendor Lead Times → Orders / Spare Forecast / Vendors.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function vendorLeadTimesRelatedLinks(
  orgId?: string | null,
  options?: { active?: VendorLeadTimesRelatedId; include?: VendorLeadTimesRelatedId[] },
): VendorLeadTimesRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return VENDOR_LEAD_TIMES_RELATED_LINKS.filter((link) => {
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

export type VendorLeadTimesShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type VendorLeadTimesNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type VendorLeadTimesEmptyCopy = {
  kind: VendorLeadTimesShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real vendor / reorder counts only — never invent DEMO lead-time totals. */
export function formatVendorLeadTimesMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no vendors exist — avoids DEMO counters. */
export function shouldShowVendorLeadTimesSummaryTiles(vendorCount: number): boolean {
  return vendorCount > 0;
}

/** Classify Vendor Lead Times Soft-UI shell — never invents DEMO reorder metrics. */
export function classifyVendorLeadTimesShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  vendorCount?: number;
}): VendorLeadTimesShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.vendorCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO reorder metrics. */
export function vendorLeadTimesShellCopy(kind: VendorLeadTimesShellKind): VendorLeadTimesEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Vendor Lead Times…",
        description:
          "Checking workspace membership and real vendor / reorder rows.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Vendor Lead Times",
        description:
          "A network or server issue blocked the tracker. Retry, or open Orders / Spare Forecast / Vendors while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Vendor Lead Times is org-scoped. Pick a workspace before logging real vendors and reorders — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No vendors yet",
        title: "Add a vendor before tracking reorders",
        description:
          "Order-by dates stay blank until you log a real vendor lead time. Cross-check Orders, Spare Forecast, and Vendors.",
      };
    default:
      return {
        kind: "ready",
        title: "Vendor lead times & reorder-by dates",
        description:
          "Order-by dates use only logged lead times, safety buffers, and needed-by dates.",
      };
  }
}

/**
 * Soft-UI next actions for Vendor Lead Times empty/setup shells.
 * Points at Orders / Spare Forecast / Vendors — never invents DEMO reorder metrics.
 */
export function vendorLeadTimesNextActions(input: {
  orgId?: string | null;
  shell: VendorLeadTimesShellKind;
  vendorCount?: number;
  openReorderCount?: number;
  overdueCount?: number;
}): VendorLeadTimesNextAction[] {
  const orgId = input.orgId ?? null;
  const vendorCount = input.vendorCount ?? 0;
  const openReorderCount = input.openReorderCount ?? 0;
  const overdueCount = input.overdueCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Lead times are org-scoped — pick a team before logging vendors.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "orders",
          label: "Open Orders",
          detail: "Purchase orders stay empty until drafted.",
          href: hubHref("/business", "orders", null),
        },
        {
          id: "spare-forecast",
          label: "Open Spare Forecast",
          detail: "Spare shortfalls stay blank until inventory + FMEA land.",
          href: hubHref("/build", "spare-forecast", null),
        },
        {
          id: "vendors",
          label: "Open Vendors",
          detail: "Supplier directory stays empty until you add contacts.",
          href: withOrgHref("/vendors", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Vendor Lead Times can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "When a reorder is due, turn it into a real purchase order.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Projected spare shortfalls often drive the next reorder window.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
      {
        id: "vendors",
        label: "Open Vendors",
        detail: "Keep supplier contacts aligned with the lead times you log here.",
        href: withOrgHref("/vendors", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Vendor Lead Times",
        detail: "Reload real vendors and reorders — nothing is invented while this fails.",
        href: withOrgHref("/vendor-lead-times", orgId),
        primary: true,
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "Existing purchase orders stay available while the tracker reloads.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Spare projections stay available while lead times reload.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
      {
        id: "vendors",
        label: "Open Vendors",
        detail: "Supplier contacts stay available while lead times reload.",
        href: withOrgHref("/vendors", orgId),
      },
    ];
  }

  if (input.shell === "empty" || vendorCount === 0) {
    return [
      {
        id: "add-vendor",
        label: "Add a vendor",
        detail: "Log a real lead time and safety buffer — order-by dates stay blank until then.",
        href: "#vendor-lead-times-add-vendor",
        primary: true,
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
        detail: "See which spare bins may need a restock before you set needed-by dates.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
      {
        id: "vendors",
        label: "Open Vendors",
        detail: "Cross-check supplier contacts before logging lead times here.",
        href: withOrgHref("/vendors", orgId),
      },
    ].slice(0, 4);
  }

  const actions: VendorLeadTimesNextAction[] = [];

  if (overdueCount > 0) {
    actions.push({
      id: "reorders",
      label: "Review overdue reorders",
      detail: `${overdueCount} open reorder${overdueCount === 1 ? "" : "s"} past order-by — place or update real lines only.`,
      href: "#vendor-lead-times-reorders",
      primary: true,
    });
  } else if (openReorderCount === 0) {
    actions.push({
      id: "log-reorder",
      label: "Log a reorder",
      detail: "Needed-by + lead time + buffer compute the order-by date.",
      href: "#vendor-lead-times-add-reorder",
      primary: true,
    });
  } else {
    actions.push({
      id: "reorders",
      label: "Review open reorders",
      detail: `${openReorderCount} open reorder${openReorderCount === 1 ? "" : "s"} with real order-by dates.`,
      href: "#vendor-lead-times-reorders",
      primary: true,
    });
  }

  actions.push(
    {
      id: "orders",
      label: "Open Orders",
      detail: "Promote due reorders into season purchase orders.",
      href: hubHref("/business", "orders", orgId),
    },
    {
      id: "spare-forecast",
      label: "Open Spare Forecast",
      detail: "Align restock windows with projected spare exhaustion.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
    {
      id: "vendors",
      label: "Open Vendors",
      detail: "Keep supplier contacts aligned with the lead times logged here.",
      href: withOrgHref("/vendors", orgId),
    },
  );

  return actions.slice(0, 5);
}
