import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Soft-UI related surfaces for Event-Day Stress Planner (never DEMO schedule blocks). */
export const EVENT_DAY_PLAN_RELATED_LINKS = [
  { id: "command", label: "Command", tab: "command" },
  { id: "battery-rotation", label: "Battery Rotation", tab: "battery-rotation" },
  { id: "pit-repair-triage", label: "Repair triage", tab: "pit-repair-triage" },
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

function eventDayPlanRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    eventDayPlanRelatedLinks(orgId, {
      include: [...EVENT_DAY_PLAN_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = eventDayPlanRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function eventDayPlanSetupSteps(orgId?: string | null): EventDayPlanSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open event-day plans.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull the official match schedule so the day plan can fill in.",
      href: withOrgHref("/team/data", orgId),
    },
  ]);
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
        description: "Checking which team you are on and plan date.",
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
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before overlaying quals, batteries, and pit windows.",
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
    return setupActionsFrom(eventDayPlanSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Event-Day Plan",
        detail: "Reload real schedule blocks.",
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
        label: "Open Repair triage",
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
      label: "Open Repair triage",
      detail: "Fit repair windows around quals and logistics.",
      href: hubHref("/competition", "pit-repair-triage", orgId),
    },
  ];
}
