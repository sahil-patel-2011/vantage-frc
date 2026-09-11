import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Bin/Shelf Locator (never DEMO inventory pins). */
export const BIN_SHELF_LOCATOR_RELATED_LINKS = [
  { id: "spare-forecast", label: "Spare Forecast", tab: "spare-forecast" },
  { id: "spare-robot-kit", label: "Spare Robot Kit", tab: "spare-robot-kit" },
  { id: "cad", label: "CAD", tab: "cad" },
  { id: "prototype", label: "Prototypes", tab: "prototype" },
] as const;

export type BinShelfLocatorRelatedId = (typeof BIN_SHELF_LOCATOR_RELATED_LINKS)[number]["id"];

export type BinShelfLocatorRelatedLink = {
  id: BinShelfLocatorRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Spares / CAD. */
export const BIN_SHELF_LOCATOR_RELATED_INCLUDE: BinShelfLocatorRelatedId[] = [
  "spare-forecast",
  "spare-robot-kit",
  "cad",
];

/**
 * Soft-UI cross-links from Bin/Shelf Locator → Spares / CAD.
 * Build with hubHref — never broken JSX href templates.
 */
export function binShelfLocatorRelatedLinks(
  orgId?: string | null,
  options?: { active?: BinShelfLocatorRelatedId; include?: BinShelfLocatorRelatedId[] },
): BinShelfLocatorRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return BIN_SHELF_LOCATOR_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/build", link.tab, orgId),
  }));
}

export type BinShelfLocatorShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type BinShelfLocatorNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type BinShelfLocatorEmptyCopy = {
  kind: BinShelfLocatorShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type BinShelfLocatorSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function binShelfLocatorSetupSteps(orgId?: string | null): BinShelfLocatorSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open bin locations.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "locations",
      label: "Add a bin or shelf",
      detail: "Locations stay blank until your team maps them.",
      href: orgId ? withOrgHref("/bin-shelf-locator", orgId) : "/bin-shelf-locator",
    },
    {
      id: "spare-forecast",
      label: "Open Spare Forecast",
      detail: "Pair shelf locations with spare-parts forecasts.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
  ];
}

/** Real location / item counts only — never invent DEMO totals. */
export function formatBinShelfLocatorMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no locations exist — avoids DEMO counters. */
export function shouldShowBinShelfLocatorSummaryTiles(locationCount: number): boolean {
  return locationCount > 0;
}

/** Classify Bin/Shelf Locator Soft-UI shell — never invents DEMO inventory pins. */
export function classifyBinShelfLocatorShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  locationCount?: number;
}): BinShelfLocatorShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.locationCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO inventory pins. */
export function binShelfLocatorShellCopy(kind: BinShelfLocatorShellKind): BinShelfLocatorEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Bin/Shelf Locator…",
        description: "Checking which team you are on and mapped locations.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Bin/Shelf Locator",
        description:
          "A network or server issue blocked location maps. Retry, or open Spare Forecast while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before mapping bins.",
      };
    case "empty":
      return {
        kind,
        badge: "No locations yet",
        title: "Map your first bin or shelf",
        description:
          "QR/NFC find results appear only after real locations exist.",
      };
    default:
      return {
        kind: "ready",
        title: "Shop locations from your map",
        description: "Bins and shelves from your team only.",
      };
  }
}

/**
 * Soft-UI next actions for Bin/Shelf Locator empty/setup shells.
 * Points at Spares / CAD — never invents DEMO inventory pins.
 */
export function binShelfLocatorNextActions(input: {
  orgId?: string | null;
  shell: BinShelfLocatorShellKind;
  locationCount?: number;
  itemCount?: number;
}): BinShelfLocatorNextAction[] {
  const orgId = input.orgId ?? null;
  const locationCount = input.locationCount ?? 0;
  const itemCount = input.itemCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before mapping bins.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "spare-forecast",
          label: "Open Spare Forecast",
          detail: "Spare forecasts stay available without inventing locations.",
          href: hubHref("/build", "spare-forecast", null),
        },
        {
          id: "cad",
          label: "Open CAD",
          detail: "Mechanical work stays separate from shelf maps.",
          href: hubHref("/build", "cad", null),
        },
      ];
    }
    return [
      {
        id: "locations",
        label: "Add a bin or shelf",
        detail: "Locations stay blank until your team maps them.",
        href: withOrgHref("/bin-shelf-locator", orgId) + "#bin-shelf-locations",
        primary: true,
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Pair shelf maps with spare-parts forecasts.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "CAD stays available while locations are mapped.",
        href: hubHref("/build", "cad", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Bin/Shelf Locator",
        detail: "Reload real locations.",
        href: withOrgHref("/bin-shelf-locator", orgId),
        primary: true,
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Spare forecasts stay available while the map reloads.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
      {
        id: "cad",
        label: "Open CAD",
        detail: "CAD stays available while the map reloads.",
        href: hubHref("/build", "cad", orgId),
      },
    ];
  }

  if (input.shell === "empty" || locationCount === 0) {
    return [
      {
        id: "add-location",
        label: "Map the first location",
        detail: "Find results stay blank until bins exist.",
        href: "#bin-shelf-locations",
        primary: true,
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Forecasts pair with shelf maps once locations exist.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
      {
        id: "spare-robot-kit",
        label: "Open Spare Robot Kit",
        detail: "Kit checklists stay separate from bin maps.",
        href: hubHref("/build", "spare-robot-kit", orgId),
      },
    ];
  }

  return [
    {
      id: itemCount > 0 ? "find-items" : "assign-items",
      label: itemCount > 0 ? "Find items by QR/code" : "Assign items to locations",
      detail:
        itemCount > 0
          ? `${itemCount} item${itemCount === 1 ? "" : "s"} pinned across ${locationCount} location${locationCount === 1 ? "" : "s"}`
          : `${locationCount} location${locationCount === 1 ? "" : "s"} mapped — assign items before scanning.`,
      href: itemCount > 0 ? "#bin-shelf-find" : "#bin-shelf-locations",
      primary: true,
    },
    {
      id: "spare-forecast",
      label: "Open Spare Forecast",
      detail: "Carry shelf locations into spare-parts planning.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
    {
      id: "cad",
      label: "Open CAD",
      detail: "Mechanical releases stay separate from shop maps.",
      href: hubHref("/build", "cad", orgId),
    },
  ];
}
