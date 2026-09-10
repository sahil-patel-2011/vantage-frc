import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Equipment Maintenance (never DEMO service logs). */
export const EQUIPMENT_MAINTENANCE_RELATED_LINKS = [
  { id: "tool-checkout", label: "Tool Checkout", tab: "tool-checkout" },
  { id: "safety-training", label: "Safety Training", tab: "safety-training" },
  { id: "checklist-library", label: "Checklist Library", tab: "checklist-library" },
  { id: "pit-map-planner", label: "Pit Map", tab: "pit-map-planner" },
] as const;

export type EquipmentMaintenanceRelatedId = (typeof EQUIPMENT_MAINTENANCE_RELATED_LINKS)[number]["id"];

export type EquipmentMaintenanceRelatedLink = {
  id: EquipmentMaintenanceRelatedId;
  label: string;
  href: string;
};

export const EQUIPMENT_MAINTENANCE_RELATED_INCLUDE: EquipmentMaintenanceRelatedId[] = [
  "tool-checkout",
  "safety-training",
  "checklist-library",
];

export function equipmentMaintenanceRelatedLinks(
  orgId?: string | null,
  options?: { active?: EquipmentMaintenanceRelatedId; include?: EquipmentMaintenanceRelatedId[] },
): EquipmentMaintenanceRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return EQUIPMENT_MAINTENANCE_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type EquipmentMaintenanceShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type EquipmentMaintenanceNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type EquipmentMaintenanceEmptyCopy = {
  kind: EquipmentMaintenanceShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type EquipmentMaintenanceSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function equipmentMaintenanceSetupSteps(orgId?: string | null): EquipmentMaintenanceSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open equipment logs.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "tools",
      label: "Open Tool Checkout",
      detail: "Hand tools that leave the shop sit beside machine maintenance.",
      href: hubHref("/team", "tool-checkout", orgId),
    },
    {
      id: "safety",
      label: "Open Safety Training",
      detail: "Operators who service machines need completed training.",
      href: hubHref("/team", "safety-training", orgId),
    },
  ];
}

export function formatEquipmentMaintenanceMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowEquipmentMaintenanceSummaryTiles(assetCount: number, logCount: number): boolean {
  return assetCount > 0 || logCount > 0;
}

export function classifyEquipmentMaintenanceShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  assetCount?: number;
}): EquipmentMaintenanceShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.assetCount ?? 0) === 0) return "empty";
  return "ready";
}

export function equipmentMaintenanceShellCopy(kind: EquipmentMaintenanceShellKind): EquipmentMaintenanceEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Equipment Maintenance…",
        description: "Checking workspace membership and service logs.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Equipment Maintenance",
        description:
          "A network or server issue blocked equipment logs. Retry, or open Tool Checkout while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Pick a workspace before registering real shop machines.",
      };
    case "empty":
      return {
        kind,
        badge: "No equipment yet",
        title: "Add your first piece of shop equipment",
        description:
          "Mills, printers, saws, and welders you add here get schedules from what you log.",
      };
    default:
      return {
        kind: "ready",
        title: "Equipment maintenance",
        description: "Assets and logs from your shop only.",
      };
  }
}

export function equipmentMaintenanceNextActions(input: {
  orgId?: string | null;
  shell: EquipmentMaintenanceShellKind;
  assetCount?: number;
  overdueCount?: number;
}): EquipmentMaintenanceNextAction[] {
  const orgId = input.orgId ?? null;
  const assetCount = input.assetCount ?? 0;
  const overdueCount = input.overdueCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of equipmentMaintenanceSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(equipmentMaintenanceSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Equipment Maintenance",
        detail: "Reload real service logs.",
        href: withOrgHref("/equipment-maintenance", orgId),
        primary: true,
      },
      {
        id: "tools",
        label: "Open Tool Checkout",
        detail: "Tool loans stay available while maintenance reloads.",
        href: hubHref("/team", "tool-checkout", orgId),
      },
      {
        id: "checklists",
        label: "Open Checklist Library",
        detail: "Checklists stay available while maintenance reloads.",
        href: hubHref("/team", "checklist-library", orgId),
      },
    ];
  }

  if (input.shell === "empty" || assetCount === 0) {
    return [
      {
        id: "add-asset",
        label: "Add shop equipment",
        detail: "The registry stays blank until you add one.",
        href: "#equipment-maintenance-add",
        primary: true,
      },
      {
        id: "tools",
        label: "Open Tool Checkout",
        detail: "Register hand tools beside future machines.",
        href: hubHref("/team", "tool-checkout", orgId),
      },
      {
        id: "inventory",
        label: "Open Inventory",
        detail: "Parts bins that feed machine service live in Inventory.",
        href: withOrgHref("/inventory", orgId),
      },
    ];
  }

  return [
    {
      id: overdueCount > 0 ? "overdue" : "log-service",
      label: overdueCount > 0 ? "Clear overdue service" : "Log maintenance",
      detail:
        overdueCount > 0
          ? `${overdueCount} overdue asset${overdueCount === 1 ? "" : "s"} from real schedules.`
          : `${assetCount} asset${assetCount === 1 ? "" : "s"} tracked.`,
      href: overdueCount > 0 ? "#equipment-maintenance-assets" : "#equipment-maintenance-log",
      primary: true,
    },
    {
      id: "tools",
      label: "Open Tool Checkout",
      detail: "Cross-check hand-tool loans with machine service.",
      href: hubHref("/team", "tool-checkout", orgId),
    },
    {
      id: "safety",
      label: "Open Safety Training",
      detail: "Confirm service operators completed required training.",
      href: hubHref("/team", "safety-training", orgId),
    },
  ];
}
