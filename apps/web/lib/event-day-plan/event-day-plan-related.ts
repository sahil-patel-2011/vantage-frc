import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Event-Day Stress Planner (never DEMO schedule blocks). */
export const EVENT_DAY_PLAN_RELATED_LINKS = [
  { id: "command", label: "Command", tab: "command" },
  { id: "battery-rotation", label: "Battery Rotation", tab: "battery-rotation" },
  { id: "pit-repair-triage", label: "Pit Repair Triage", tab: "pit-repair-triage" },
  { id: "shift-balancer", label: "Shift Balancer", tab: "shift-balancer" },
] as const;

export type EventDayPlanRelatedId = (typeof EVENT_DAY_PLAN_RELATED_LINKS)[number]["id"];

export type EventDayPlanRelatedLink = {
  id: EventDayPlanRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Command / Batteries / Pit Repair. */
export const EVENT_DAY_PLAN_RELATED_INCLUDE: EventDayPlanRelatedId[] = [
  "command",
  "battery-rotation",
  "pit-repair-triage",
];

/**
 * Soft-UI cross-links from Event-Day Plan → Command / Batteries / Pit.
 * Build with hubHref — never broken JSX href templates.
 */
export function eventDayPlanRelatedLinks(
  orgId?: string | null,
  options?: { active?: EventDayPlanRelatedId; include?: EventDayPlanRelatedId[] },
): EventDayPlanRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return EVENT_DAY_PLAN_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type EventDayPlanShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type EventDayPlanNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type EventDayPlanEmptyCopy = {
  kind: EventDayPlanShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type EventDayPlanSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function eventDayPlanSetupSteps(orgId?: string | null): EventDayPlanSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — event-day plans are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Confirm the active event and match schedule.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "battery-rotation",
      label: "Open Battery Rotation",
      detail: "Charge windows overlay on the same hourly plan.",
      href: hubHref("/competition", "battery-rotation", orgId),
    },
    {
      id: "pit-repair-triage",
      label: "Open Pit Repair Triage",
      detail: "Repair windows stay blank until real pit work is logged.",
      href: hubHref("/competition", "pit-repair-triage", orgId),
    },
  ];
}

/** Real block / conflict counts only — never invent DEMO totals. */
export function formatEventDayPlanMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no blocks exist — avoids DEMO counters. */
export function shouldShowEventDayPlanSummaryTiles(blockCount: number): boolean {
  return blockCount > 0;
}

/** Classify Event-Day Plan Soft-UI shell — never invents DEMO schedule blocks. */
export function classifyEventDayPlanShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  blockCount?: number;
}): EventDayPlanShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.blockCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO schedule blocks. */
export function eventDayPlanShellCopy(kind: EventDayPlanShellKind): EventDayPlanEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Event-Day Plan…",
        description: "Checking workspace membership and plan date.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Event-Day Plan",
        description:
          "A network or server issue blocked the planner. Retry, or open Command while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Event-Day Plan is org-scoped. Pick a workspace before overlaying quals, batteries, and pit windows — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No blocks yet",
        title: "Add your first event-day block",
        description:
          "Qual matches, battery charges, scout shifts, pit-repair windows, and logistics overlay here.",
      };
    default:
      return {
        kind: "ready",
        title: "Hourly event-day overlay",
        description:
          "Blocks and conflicts from your team only.",
      };
  }
}

/**
 * Soft-UI next actions for Event-Day Plan empty/setup shells.
 * Points at Command / Batteries / Pit — never invents DEMO schedule blocks.
 */
export function eventDayPlanNextActions(input: {
  orgId?: string | null;
  shell: EventDayPlanShellKind;
  blockCount?: number;
  conflictCount?: number;
}): EventDayPlanNextAction[] {
  const orgId = input.orgId ?? null;
  const blockCount = input.blockCount ?? 0;
  const conflictCount = input.conflictCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Event-day plans are org-scoped — pick a team before adding blocks.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "command",
          label: "Open Command",
          detail: "Event Day stays blank until real schedule data exists.",
          href: hubHref("/competition", "command", null),
        },
        {
          id: "battery-rotation",
          label: "Open Battery Rotation",
          detail: "Charge planners stay empty until real batteries exist.",
          href: hubHref("/competition", "battery-rotation", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Event-Day Plan can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Confirm active event before overlaying the day.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "battery-rotation",
        label: "Open Battery Rotation",
        detail: "Align charge windows with the hourly plan.",
        href: hubHref("/competition", "battery-rotation", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Event-Day Plan",
        detail: "Reload real schedule blocks — nothing is invented while this fails.",
        href: withOrgHref("/event-day-plan", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Command stays available while the planner reloads.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "pit-repair-triage",
        label: "Open Pit Repair Triage",
        detail: "Pit work stays available while the planner reloads.",
        href: hubHref("/competition", "pit-repair-triage", orgId),
      },
    ];
  }

  if (input.shell === "empty" || blockCount === 0) {
    return [
      {
        id: "add-block",
        label: "Add the first block",
        detail: "Blocks stay blank until your team logs them.",
        href: "#event-day-plan-add",
        primary: true,
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Cross-check live event-day context beside the hourly overlay.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "shift-balancer",
        label: "Open Shift Balancer",
        detail: "Scout shifts can land on the same plan once assigned.",
        href: hubHref("/competition", "shift-balancer", orgId),
      },
    ];
  }

  return [
    {
      id: conflictCount > 0 ? "resolve-conflicts" : "review-plan",
      label: conflictCount > 0 ? "Resolve schedule conflicts" : "Review hourly overlay",
      detail:
        conflictCount > 0
          ? `${conflictCount} conflict${conflictCount === 1 ? "" : "s"} from real overlapping blocks.`
          : `${blockCount} real block${blockCount === 1 ? "" : "s"} on today's plan.`,
      href: conflictCount > 0 ? "#event-day-plan-conflicts" : "#event-day-plan-hourly",
      primary: true,
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Carry the day plan into event-day ops.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "battery-rotation",
      label: "Open Battery Rotation",
      detail: "Align charge banks with the hourly overlay.",
      href: hubHref("/competition", "battery-rotation", orgId),
    },
    {
      id: "pit-repair-triage",
      label: "Open Pit Repair Triage",
      detail: "Fit repair windows around quals and logistics.",
      href: hubHref("/competition", "pit-repair-triage", orgId),
    },
  ];
}
