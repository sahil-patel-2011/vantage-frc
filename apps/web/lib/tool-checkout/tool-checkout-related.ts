import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Tool Checkout (never DEMO loan ledgers). */
export const TOOL_CHECKOUT_RELATED_LINKS = [
  { id: "equipment-maintenance", label: "Equipment Maintenance", tab: "equipment-maintenance" },
  { id: "training", label: "Training matrix", tab: "training" },
  { id: "checklist-library", label: "Checklist Library", tab: "checklist-library" },
  { id: "safety-training", label: "Safety Training", tab: "safety-training" },
  { id: "pit-map-planner", label: "Pit Map", tab: "pit-map-planner" },
] as const;

export type ToolCheckoutRelatedId = (typeof TOOL_CHECKOUT_RELATED_LINKS)[number]["id"];

export type ToolCheckoutRelatedLink = {
  id: ToolCheckoutRelatedId;
  label: string;
  href: string;
};

export const TOOL_CHECKOUT_RELATED_INCLUDE: ToolCheckoutRelatedId[] = [
  "equipment-maintenance",
  "training",
  "checklist-library",
  "safety-training",
];

export function toolCheckoutRelatedLinks(
  orgId?: string | null,
  options?: { active?: ToolCheckoutRelatedId; include?: ToolCheckoutRelatedId[] },
): ToolCheckoutRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return TOOL_CHECKOUT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type ToolCheckoutShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ToolCheckoutNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ToolCheckoutEmptyCopy = {
  kind: ToolCheckoutShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ToolCheckoutSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function toolCheckoutSetupSteps(orgId?: string | null): ToolCheckoutSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — tool loans are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "equipment",
      label: "Open Equipment Maintenance",
      detail: "Register shop machines beside hand tools you check out.",
      href: hubHref("/team", "equipment-maintenance", orgId),
    },
    {
      id: "inventory",
      label: "Open Inventory",
      detail: "Asset-tagged tools can cross-check stock locations.",
      href: withOrgHref("/inventory", orgId),
    },
  ];
}

export function formatToolCheckoutMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowToolCheckoutSummaryTiles(toolCount: number): boolean {
  return toolCount > 0;
}

export function classifyToolCheckoutShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  toolCount?: number;
}): ToolCheckoutShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.toolCount ?? 0) === 0) return "empty";
  return "ready";
}

export function toolCheckoutShellCopy(kind: ToolCheckoutShellKind): ToolCheckoutEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Tool Checkout…",
        description: "Checking workspace membership and tool loans — never DEMO checkout ledgers.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Tool Checkout",
        description:
          "A network or server issue blocked the tool registry. Retry, or open Equipment while it reloads — never invent DEMO loans.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Tool Checkout is org-scoped. Pick a workspace before registering real shop tools — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No tools yet",
        title: "Add your first shop tool",
        description:
          "Register drills, calipers, and chargers so loans stay real — never DEMO checkout packs.",
      };
    default:
      return {
        kind: "ready",
        title: "Tool checkout",
        description: "Tools and loans from your registry only — never DEMO counters.",
      };
  }
}

export function toolCheckoutNextActions(input: {
  orgId?: string | null;
  shell: ToolCheckoutShellKind;
  toolCount?: number;
  overdueCount?: number;
}): ToolCheckoutNextAction[] {
  const orgId = input.orgId ?? null;
  const toolCount = input.toolCount ?? 0;
  const overdueCount = input.overdueCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Tool loans are org-scoped — pick a team before registering tools.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "equipment",
          label: "Open Equipment Maintenance",
          detail: "Shop machines stay blank until you add them.",
          href: hubHref("/team", "equipment-maintenance", null),
        },
        {
          id: "inventory",
          label: "Open Inventory",
          detail: "Stock locations stay empty until parts are logged.",
          href: "/inventory",
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Tool Checkout can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "equipment",
        label: "Open Equipment Maintenance",
        detail: "Track mills and printers beside hand-tool loans.",
        href: hubHref("/team", "equipment-maintenance", orgId),
      },
      {
        id: "inventory",
        label: "Open Inventory",
        detail: "Cross-check asset tags with stock locations.",
        href: withOrgHref("/inventory", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Tool Checkout",
        detail: "Reload real tool loans — nothing is invented while this fails.",
        href: withOrgHref("/tool-checkout", orgId),
        primary: true,
      },
      {
        id: "equipment",
        label: "Open Equipment Maintenance",
        detail: "Equipment stays available while checkout reloads.",
        href: hubHref("/team", "equipment-maintenance", orgId),
      },
      {
        id: "safety",
        label: "Open Safety Training",
        detail: "Training stays available while checkout reloads.",
        href: hubHref("/team", "safety-training", orgId),
      },
    ];
  }

  if (input.shell === "empty" || toolCount === 0) {
    return [
      {
        id: "add-tool",
        label: "Add a shop tool",
        detail: "The registry stays blank until you add one — never DEMO loan ledgers.",
        href: "#tool-checkout-add",
        primary: true,
      },
      {
        id: "equipment",
        label: "Open Equipment Maintenance",
        detail: "Register shop machines beside hand tools.",
        href: hubHref("/team", "equipment-maintenance", orgId),
      },
      {
        id: "inventory",
        label: "Open Inventory",
        detail: "Tag tools that also live in stock bins.",
        href: withOrgHref("/inventory", orgId),
      },
    ];
  }

  return [
    {
      id: overdueCount > 0 ? "overdue" : "registry",
      label: overdueCount > 0 ? "Chase overdue loans" : "Review tool registry",
      detail:
        overdueCount > 0
          ? `${overdueCount} overdue loan${overdueCount === 1 ? "" : "s"} from real checkouts — never DEMO ledgers.`
          : `${toolCount} tool${toolCount === 1 ? "" : "s"} tracked — never DEMO counters.`,
      href: "#tool-checkout-registry",
      primary: true,
    },
    {
      id: "equipment",
      label: "Open Equipment Maintenance",
      detail: "Service shop machines beside hand-tool loans.",
      href: hubHref("/team", "equipment-maintenance", orgId),
    },
    {
      id: "training",
      label: "Open Training matrix",
      detail: "Checkout refuses a tool when the borrower is missing a required cert.",
      href: hubHref("/team", "training", orgId),
    },
  ];
}
