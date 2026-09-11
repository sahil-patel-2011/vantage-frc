import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Vendor Directory (never DEMO vendor metrics). */
export const VENDORS_RELATED_LINKS = [
  { id: "orders", label: "Orders", kind: "business" as const, tab: "orders" },
  {
    id: "vendor-lead-times",
    label: "Vendor Lead Times",
    kind: "business" as const,
    tab: "vendor-lead-times",
  },
  { id: "inventory", label: "Inventory", kind: "path" as const, path: "/inventory" },
  { id: "spare-forecast", label: "Spare Forecast", kind: "build" as const, tab: "spare-forecast" },
] as const;

export type VendorsRelatedId = (typeof VENDORS_RELATED_LINKS)[number]["id"];

export type VendorsRelatedLink = {
  id: VendorsRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Orders / Vendor Lead Times first. */
export const VENDORS_RELATED_INCLUDE: VendorsRelatedId[] = ["orders", "vendor-lead-times"];

/**
 * Soft-UI cross-links from Vendors → Orders / Vendor Lead Times.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function vendorsRelatedLinks(
  orgId?: string | null,
  options?: { active?: VendorsRelatedId; include?: VendorsRelatedId[] },
): VendorsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return VENDORS_RELATED_LINKS.filter((link) => {
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

export type VendorsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type VendorsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type VendorsEmptyCopy = {
  kind: VendorsShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real vendor counts only — never invent DEMO directory totals. */
export function formatVendorsMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no vendors exist — avoids DEMO counters. */
export function shouldShowVendorsSummaryTiles(vendorCount: number): boolean {
  return vendorCount > 0;
}

/** Classify Vendors Soft-UI shell — never invents DEMO vendor metrics. */
export function classifyVendorsShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  vendorCount?: number;
}): VendorsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.vendorCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO vendor metrics. */
export function vendorsShellCopy(kind: VendorsShellKind): VendorsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Vendor Directory…",
        description:
          "Checking which team you are on and real supplier rows.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Vendor Directory",
        description:
          "A network or server issue blocked the directory. Retry, or open Orders / Vendor Lead Times while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before adding real suppliers.",
      };
    case "empty":
      return {
        kind,
        badge: "No vendors yet",
        title: "Add a supplier before building the directory",
        description:
          "Contacts, lead times, and ratings stay blank until you add a real vendor. Orders require a supplier from this directory. Cross-check Orders and Vendor Lead Times.",
      };
    default:
      return {
        kind: "ready",
        title: "Team vendor directory",
        description:
          "Preferred flags, ratings, and contacts use only logged suppliers.",
      };
  }
}

/**
 * Soft-UI next actions for Vendors empty/setup shells.
 * Points at Orders / Vendor Lead Times — never invents DEMO vendor metrics.
 */
export function vendorsNextActions(input: {
  orgId?: string | null;
  shell: VendorsShellKind;
  vendorCount?: number;
  preferredCount?: number;
  missingContactCount?: number;
}): VendorsNextAction[] {
  const orgId = input.orgId ?? null;
  const vendorCount = input.vendorCount ?? 0;
  const preferredCount = input.preferredCount ?? 0;
  const missingContactCount = input.missingContactCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before adding suppliers.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "orders",
          label: "Open Orders",
          detail: "Purchase orders stay empty until you pick a directory vendor.",
          href: hubHref("/business", "orders", null),
        },
        {
          id: "vendor-lead-times",
          label: "Open Vendor Lead Times",
          detail: "Reorder-by dates stay blank until lead times land.",
          href: hubHref("/business", "vendor-lead-times", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Vendor Directory can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "When you reorder, turn supplier choices into real purchase orders.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "vendor-lead-times",
        label: "Open Vendor Lead Times",
        detail: "Keep reorder windows aligned with the contacts you store here.",
        href: hubHref("/business", "vendor-lead-times", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Vendor Directory",
        detail: "Reload real suppliers.",
        href: withOrgHref("/vendors", orgId),
        primary: true,
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "Existing purchase orders stay available while the directory reloads.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "vendor-lead-times",
        label: "Open Vendor Lead Times",
        detail: "Lead-time tracking stays available while the directory reloads.",
        href: hubHref("/business", "vendor-lead-times", orgId),
      },
    ];
  }

  if (input.shell === "empty" || vendorCount === 0) {
    return [
      {
        id: "add-vendor",
        label: "Add a vendor",
        detail: "Name, category, and contacts stay blank until you enter a real supplier.",
        href: "#vendors-add-vendor",
        primary: true,
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "Purchase orders stay blank until you pick a directory vendor.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "vendor-lead-times",
        label: "Open Vendor Lead Times",
        detail: "Log lead times once you know which suppliers you buy from.",
        href: hubHref("/business", "vendor-lead-times", orgId),
      },
    ].slice(0, 4);
  }

  const actions: VendorsNextAction[] = [];

  if (missingContactCount > 0) {
    actions.push({
      id: "fill-contacts",
      label: "Fill missing contacts",
      detail: `${missingContactCount} vendor${missingContactCount === 1 ? "" : "s"} missing email and phone — update real rows only.`,
      href: "#vendors-directory",
      primary: true,
    });
  } else if (preferredCount === 0) {
    actions.push({
      id: "mark-preferred",
      label: "Mark a preferred supplier",
      detail: "Preferred flags help the next season reorder without hunting.",
      href: "#vendors-directory",
      primary: true,
    });
  } else {
    actions.push({
      id: "directory",
      label: "Review vendor directory",
      detail: `${vendorCount} real supplier${vendorCount === 1 ? "" : "s"} — keep contacts and lead times current.`,
      href: "#vendors-directory",
      primary: true,
    });
  }

  actions.push(
    {
      id: "orders",
      label: "Open Orders",
      detail: "Turn preferred suppliers into season purchase orders.",
      href: hubHref("/business", "orders", orgId),
    },
    {
      id: "vendor-lead-times",
      label: "Open Vendor Lead Times",
      detail: "Align reorder-by dates with the lead times you store on these contacts.",
      href: hubHref("/business", "vendor-lead-times", orgId),
    },
  );

  return actions.slice(0, 5);
}
