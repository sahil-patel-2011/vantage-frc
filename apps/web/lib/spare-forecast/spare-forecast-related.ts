import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { SeasonHorizon } from "./types";

/** Soft-UI related surfaces for Spare Forecast (never DEMO spare counts). */
export const SPARE_FORECAST_RELATED_LINKS = [
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
  { id: "orders", label: "Orders", kind: "business" as const, tab: "orders" },
  { id: "subsystems", label: "Subsystems", kind: "path" as const, path: "/subsystems" },
  { id: "inventory", label: "Inventory", kind: "path" as const, path: "/inventory" },
  { id: "fmea", label: "FMEA", kind: "build" as const, tab: "fmea" },
] as const;

export type SpareForecastRelatedId = (typeof SPARE_FORECAST_RELATED_LINKS)[number]["id"];

export type SpareForecastRelatedLink = {
  id: SpareForecastRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Batteries / Orders / Subsystems first. */
export const SPARE_FORECAST_RELATED_INCLUDE: SpareForecastRelatedId[] = [
  "batteries",
  "orders",
  "subsystems",
];

/**
 * Soft-UI cross-links from Spare Forecast → Batteries / Orders / Subsystems.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function spareForecastRelatedLinks(
  orgId?: string | null,
  options?: { active?: SpareForecastRelatedId; include?: SpareForecastRelatedId[] },
): SpareForecastRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SPARE_FORECAST_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    if (link.kind === "business") {
      return { id: link.id, label: link.label, href: hubHref("/business", link.tab, orgId) };
    }
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type SpareForecastShellKind =
  | "loading"
  | "error"
  | "setup"
  | "empty"
  | "no_risk"
  | "ready";

export type SpareForecastNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SpareForecastEmptyCopy = {
  kind: SpareForecastShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real spare / forecast counts only — never invent DEMO inventory totals. Null means unknown (offseason). */
export function formatSpareForecastMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Classify Spare Forecast Soft-UI shell — never invents DEMO spare counts. */
export function classifySpareForecastShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  spareBinCount?: number;
  forecastLineCount?: number;
}): SpareForecastShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.spareBinCount ?? 0) === 0) return "empty";
  if ((input.forecastLineCount ?? 0) === 0) return "no_risk";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO spare counts. */
export function spareForecastShellCopy(kind: SpareForecastShellKind): SpareForecastEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading spare forecast…",
        description:
          "Checking workspace membership and real spare-category inventory.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load spare-parts forecast",
        description:
          "A network or server issue blocked the forecast. Retry, or open Batteries / Orders / Subsystems while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Spare Forecast is org-scoped. Pick a workspace before projecting exhaustion from real bins — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No spare bins yet",
        title: "Stock spare-category inventory first",
        description:
          "The forecast stays blank until you add spare-category inventory items matched to subsystems. Cross-check Batteries, Orders, and Subsystems.",
      };
    case "no_risk":
      return {
        kind,
        badge: "No exhaustion risk",
        title: "No spares are projected to run out",
        description:
          "Spare bins exist, but none have matched FMEA repeat-failure history yet. Log failures and keep inventory subsystem names aligned — never invent a consumption rate.",
      };
    default:
      return {
        kind: "ready",
        title: "Spare-parts exhaustion forecast",
        description:
          "Projections use only real spare-category bins × logged FMEA cadence. Draft purchase requests from shortfalls.",
      };
  }
}

/**
 * Soft-UI next actions for Spare Forecast empty/setup shells.
 * Points at Batteries / Orders / Subsystems — never invents DEMO spare counts.
 */
export function spareForecastNextActions(input: {
  orgId?: string | null;
  shell: SpareForecastShellKind;
  spareBinCount?: number;
  forecastLineCount?: number;
  criticalCount?: number;
  purchaseRequestCount?: number;
  seasonHorizon?: SeasonHorizon;
}): SpareForecastNextAction[] {
  const orgId = input.orgId ?? null;
  const spareBinCount = input.spareBinCount ?? 0;
  const forecastLineCount = input.forecastLineCount ?? 0;
  const criticalCount = input.criticalCount ?? 0;
  const purchaseRequestCount = input.purchaseRequestCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Forecasts are org-scoped — pick a team before projecting spare exhaustion.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "batteries",
          label: "Open Batteries",
          detail: "Pack health stays blank until logged.",
          href: hubHref("/team", "batteries", null),
        },
        {
          id: "orders",
          label: "Open Orders",
          detail: "Purchase orders stay empty until drafted.",
          href: hubHref("/business", "orders", null),
        },
        {
          id: "subsystems",
          label: "Open Subsystems",
          detail: "Subsystem names stay empty until you author them.",
          href: withOrgHref("/subsystems", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Spare Forecast can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Battery packs are a common spare that should stay in rotation logs.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "When a shortfall appears, turn it into a real purchase order.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Name mechanisms so spare bins can match FMEA failure history.",
        href: withOrgHref("/subsystems", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Spare Forecast",
        detail: "Reload real inventory and FMEA cadence — nothing is invented while this fails.",
        href: withOrgHref("/spare-forecast", orgId),
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Pack rotation stays available while the forecast reloads.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "Existing purchase orders stay available while the forecast reloads.",
        href: hubHref("/business", "orders", orgId),
      },
      {
        id: "subsystems",
        label: "Open Subsystems",
        detail: "Confirm subsystem names while inventory reloads.",
        href: withOrgHref("/subsystems", orgId),
      },
    ];
  }

  if (input.shell === "empty" || spareBinCount === 0) {
    return [
      {
        id: "inventory",
        label: "Stock spare inventory",
        detail: "Add spare-category bins with subsystem tags — only real rows become forecastable.",
        href: withOrgHref("/inventory", orgId),
        primary: true,
      },
      {
        id: "subsystems",
        label: "Name Subsystems",
        detail: "Inventory subsystem labels must match FMEA names for a consumption rate.",
        href: withOrgHref("/subsystems", orgId),
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Log pack health separately in Batteries.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "Restock POs stay blank until you draft them from a real shortfall.",
        href: hubHref("/business", "orders", orgId),
      },
    ].slice(0, 4);
  }

  if (input.shell === "no_risk" || forecastLineCount === 0) {
    return [
      {
        id: "fmea",
        label: "Log FMEA failures",
        detail: "Repeat failures on a subsystem unlock consumption cadence — never invent rates.",
        href: hubHref("/build", "fmea", orgId),
        primary: true,
      },
      {
        id: "subsystems",
        label: "Align Subsystems",
        detail: "Spare bin subsystem names must match FMEA subsystem names exactly.",
        href: withOrgHref("/subsystems", orgId),
      },
      {
        id: "inventory",
        label: "Review Inventory",
        detail: "Confirm spare-category bins still have the right subsystem tags.",
        href: withOrgHref("/inventory", orgId),
      },
      {
        id: "orders",
        label: "Open Orders",
        detail: "When a shortfall appears later, draft a PO from the forecast.",
        href: hubHref("/business", "orders", orgId),
      },
    ].slice(0, 4);
  }

  const actions: SpareForecastNextAction[] = [];

  if (criticalCount > 0) {
    actions.push({
      id: "draft",
      label: "Draft purchase request",
      detail: `${criticalCount} critical shortfall${criticalCount === 1 ? "" : "s"} — turn real projected exhaustions into a restock draft.`,
      href: "#spare-forecast-draft",
      primary: true,
    });
  }

  if (purchaseRequestCount === 0 && criticalCount === 0 && input.seasonHorizon !== "offseason") {
    actions.push({
      id: "draft",
      label: "Draft purchase request",
      detail: "Capture projected shortfalls as a restock draft before they hit the pit.",
      href: "#spare-forecast-draft",
      primary: true,
    });
  }

  actions.push(
    {
      id: "orders",
      label: "Open Orders",
      detail: "Promote approved restock drafts into season purchase orders.",
      href: hubHref("/business", "orders", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "Battery packs are often the first spare to rotate — keep IR and cycles logged.",
      href: hubHref("/team", "batteries", orgId),
    },
    {
      id: "subsystems",
      label: "Cross-check Subsystems",
      detail: "Confirm each forecasted bin still matches a live robot subsystem.",
      href: withOrgHref("/subsystems", orgId),
    },
    {
      id: "fmea",
      label: "Open FMEA",
      detail: "When failure cadence changes, re-check which bins will exhaust first.",
      href: hubHref("/build", "fmea", orgId),
    },
  );

  return actions.slice(0, 5);
}
