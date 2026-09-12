import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Spare Robot Kit (never DEMO pack lists). */
export const SPARE_ROBOT_KIT_RELATED_LINKS = [
  { id: "fmea", label: "Failure log", tab: "fmea" },
  { id: "spare-forecast", label: "Spare Forecast", tab: "spare-forecast" },
  { id: "batteries", label: "Batteries", tab: "batteries" },
  { id: "readiness-score", label: "Readiness", tab: "readiness-score" },
] as const;

export type SpareRobotKitRelatedId = (typeof SPARE_ROBOT_KIT_RELATED_LINKS)[number]["id"];

export type SpareRobotKitRelatedLink = {
  id: SpareRobotKitRelatedId;
  label: string;
  href: string;
};

export const SPARE_ROBOT_KIT_RELATED_INCLUDE: SpareRobotKitRelatedId[] = [
  "fmea",
  "spare-forecast",
  "batteries",
];

/**
 * Soft-UI cross-links from Spare Robot Kit → FMEA / Spare Forecast / Batteries.
 * Build with hubHref — never broken JSX href templates.
 */
export function spareRobotKitRelatedLinks(
  orgId?: string | null,
  options?: { active?: SpareRobotKitRelatedId; include?: SpareRobotKitRelatedId[] },
): SpareRobotKitRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SPARE_ROBOT_KIT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/build", link.tab, orgId),
  }));
}

export type SpareRobotKitShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type SpareRobotKitNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type SpareRobotKitEmptyCopy = {
  kind: SpareRobotKitShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type SpareRobotKitSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function spareRobotKitSetupSteps(orgId?: string | null): SpareRobotKitSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open spare kits.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Log real subsystem failures so kit candidates have failure history.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "inventory",
      label: "Open Inventory",
      detail: "Tag spare bins with subsystems — unmatched bins stay off the kit.",
      href: withOrgHref("/inventory", orgId),
    },
    {
      id: "spare-forecast",
      label: "Open Spare Forecast",
      detail: "Forecast failure demand beside the competition pack list.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
  ];
}

/** Real candidate / checklist counts only — never invent DEMO totals. */
export function formatSpareRobotKitMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing matched FMEA — avoids DEMO counters. */
export function shouldShowSpareRobotKitSummaryTiles(candidateCount: number, checklistCount: number): boolean {
  return candidateCount > 0 || checklistCount > 0;
}

/** Classify Spare Robot Kit Soft-UI shell — never invents DEMO pack lists. */
export function classifySpareRobotKitShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  candidateCount?: number;
  checklistCount?: number;
}): SpareRobotKitShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.candidateCount ?? 0) === 0 && (input.checklistCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO pack lists. */
export function spareRobotKitShellCopy(kind: SpareRobotKitShellKind): SpareRobotKitEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Spare Robot Kit…",
        description: "Checking which team you are on, spare bins, and Failure log history.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Spare Robot Kit",
        description:
          "A network or server issue blocked the checklist. Retry, or open Failure log while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before matching spares to Failure log history.",
      };
    case "empty":
      return {
        kind,
        badge: "No kit candidates yet",
        title: "Match spares to Failure log history",
        description:
          "Spare bins tagged to subsystems with logged failures surface here.",
      };
    default:
      return {
        kind: "ready",
        title: "Competition spare kit",
        description: "Candidates from inventory × Failure log only.",
      };
  }
}

/**
 * Soft-UI next actions for Spare Robot Kit empty/setup shells.
 * Points at FMEA / Inventory / Spare Forecast — never invents DEMO pack lists.
 */
export function spareRobotKitNextActions(input: {
  orgId?: string | null;
  shell: SpareRobotKitShellKind;
  candidateCount?: number;
  checklistCount?: number;
}): SpareRobotKitNextAction[] {
  const orgId = input.orgId ?? null;
  const candidateCount = input.candidateCount ?? 0;
  const checklistCount = input.checklistCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before matching bins to Failure log.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "fmea",
          label: "Open Failure log",
          detail: "Failure history stays blank until your team logs real modes.",
          href: hubHref("/build", "fmea", null),
        },
        {
          id: "inventory",
          label: "Open Inventory",
          detail: "Spare bins stay empty until stock is logged.",
          href: "/inventory",
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Spare Robot Kit can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Log subsystem failures that drive pack priority.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "inventory",
        label: "Open Inventory",
        detail: "Tag spare bins with the matching subsystem.",
        href: withOrgHref("/inventory", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Spare Robot Kit",
        detail: "Reload real Failure log × inventory matches.",
        href: withOrgHref("/spare-robot-kit", orgId),
        primary: true,
      },
      {
        id: "fmea",
        label: "Open Failure log",
        detail: "Failure log stays available while the kit reloads.",
        href: hubHref("/build", "fmea", orgId),
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Forecast stays available while the kit reloads.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (candidateCount === 0 && checklistCount === 0)) {
    return [
      {
        id: "fmea",
        label: "Log failures",
        detail: "Kit candidates stay blank until spare bins match real failure history.",
        href: hubHref("/build", "fmea", orgId),
        primary: true,
      },
      {
        id: "inventory",
        label: "Open Inventory",
        detail: "Tag spare-category bins with a subsystem name.",
        href: withOrgHref("/inventory", orgId),
      },
      {
        id: "spare-forecast",
        label: "Open Spare Forecast",
        detail: "Forecast demand stays empty until failures exist.",
        href: hubHref("/build", "spare-forecast", orgId),
      },
    ];
  }

  return [
    {
      id: checklistCount > 0 ? "pack-checklist" : "generate-checklist",
      label: checklistCount > 0 ? "Pack the competition checklist" : "Generate a checklist",
      detail:
        checklistCount > 0
          ? `${checklistCount} checklist${checklistCount === 1 ? "" : "s"} from real Failure log matches.`
          : `${candidateCount} candidate spare${candidateCount === 1 ? "" : "s"} matched to failure history.`,
      href: checklistCount > 0 ? "#spare-robot-kit-checklists" : "#spare-robot-kit-candidates",
      primary: true,
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Refresh failure history that drives pack priority.",
      href: hubHref("/build", "fmea", orgId),
    },
    {
      id: "spare-forecast",
      label: "Open Spare Forecast",
      detail: "Cross-check demand beside the pack list.",
      href: hubHref("/build", "spare-forecast", orgId),
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "Pack charge banks beside mechanical spares.",
      href: hubHref("/build", "batteries", orgId),
    },
  ];
}
