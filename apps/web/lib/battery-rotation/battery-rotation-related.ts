import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Battery Rotation (never DEMO IR / charge metrics). */
export const BATTERY_ROTATION_RELATED_LINKS = [
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
  {
    id: "battery-health-forecast",
    label: "Health Forecast",
    kind: "build" as const,
    tab: "battery-health-forecast",
  },
  { id: "pit", label: "Pit Command", kind: "path" as const, path: "/pit" },
  {
    id: "battery-rotation",
    label: "Battery Rotation",
    kind: "competition" as const,
    tab: "battery-rotation",
  },
] as const;

export type BatteryRotationRelatedId = (typeof BATTERY_ROTATION_RELATED_LINKS)[number]["id"];

export type BatteryRotationRelatedLink = {
  id: BatteryRotationRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Batteries / Health Forecast / Pit first. */
export const BATTERY_ROTATION_RELATED_INCLUDE: BatteryRotationRelatedId[] = [
  "batteries",
  "battery-health-forecast",
  "pit",
];

/**
 * Soft-UI cross-links from Battery Rotation → Batteries / Health Forecast / Pit.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function batteryRotationRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: BatteryRotationRelatedId;
    include?: BatteryRotationRelatedId[];
  },
): BatteryRotationRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return BATTERY_ROTATION_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    if (link.kind === "build") {
      return { id: link.id, label: link.label, href: hubHref("/build", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type BatteryRotationShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type BatteryRotationNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type BatteryRotationEmptyCopy = {
  kind: BatteryRotationShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO IR or charge metrics. */
export type BatteryRotationSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function batteryRotationSetupSteps(orgId?: string | null): BatteryRotationSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Battery Rotation is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "IR, voltage, and cycles stay blank until you log them — no sample health scores.",
      href: hubHref("/team", "batteries", orgId),
    },
    {
      id: "battery-health-forecast",
      label: "Open Health Forecast",
      detail: "Retirement projections stay blank until IR + cycle history exists — no sample EOL dates.",
      href: hubHref("/build", "battery-health-forecast", orgId),
    },
    {
      id: "pit",
      label: "Open Pit Command",
      detail: "Event-day rack status uses the same real pack evidence — no sample volts.",
      href: withOrgHref("/pit", orgId),
    },
  ];
}

/** Real fleet / schedule counts only — never invent DEMO IR or charge totals. */
export function formatBatteryRotationMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Plan readiness percent from real packs only — blank when no batteries exist. */
export function formatBatteryRotationPlanReadiness(
  value: unknown,
  loaded: boolean,
  batteryCount: number,
): string {
  if (!loaded || batteryCount <= 0) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed summary tiles when no batteries exist — avoids DEMO counters. */
export function shouldShowBatteryRotationSummaryTiles(batteryCount: number): boolean {
  return batteryCount > 0;
}

/** Classify Battery Rotation Soft-UI shell — never invents DEMO IR / charge metrics. */
export function classifyBatteryRotationShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  batteryCount?: number;
}): BatteryRotationShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.batteryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO IR or charge metrics. */
export function batteryRotationShellCopy(kind: BatteryRotationShellKind): BatteryRotationEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Battery Rotation…",
        description:
          "Checking workspace membership and real pack / IR logs.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Battery Rotation",
        description:
          "A network or server issue blocked the rotation board. Retry, or open Batteries / Health Forecast / Pit while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Battery Rotation is org-scoped. Pick a workspace before scheduling packs from real IR trends — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No batteries yet",
        title: "Add a pack before planning match rotation",
        description:
          "Match assignments and charge windows stay blank until you register a pack. Cross-check Batteries, Health Forecast, and Pit.",
      };
    default:
      return {
        kind: "ready",
        title: "Battery rotation & charge planner",
        description:
          "Schedules use only logged packs and IR trends.",
      };
  }
}

/**
 * Soft-UI next actions for Battery Rotation empty/setup shells.
 * Points at Batteries / Health Forecast / Pit — never invents DEMO IR or charge metrics.
 */
export function batteryRotationNextActions(input: {
  orgId?: string | null;
  shell: BatteryRotationShellKind;
  batteryCount?: number;
  shortPackCount?: number;
  chargeShortfallCount?: number;
  upcomingAssignments?: number;
}): BatteryRotationNextAction[] {
  const orgId = input.orgId ?? null;
  const batteryCount = input.batteryCount ?? 0;
  const shortPackCount = input.shortPackCount ?? 0;
  const chargeShortfallCount = input.chargeShortfallCount ?? 0;
  const upcomingAssignments = input.upcomingAssignments ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of batteryRotationSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(batteryRotationSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Battery Rotation",
        detail: "Reload real pack / charge plans — nothing is invented while this fails.",
        href: withOrgHref("/battery-rotation", orgId),
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Pack logs stay available while the rotation board reloads.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "battery-health-forecast",
        label: "Open Health Forecast",
        detail: "EOL projections stay available while the rotation board reloads.",
        href: hubHref("/build", "battery-health-forecast", orgId),
      },
      {
        id: "pit",
        label: "Open Pit Command",
        detail: "Pit rack status stays available while the rotation board reloads.",
        href: withOrgHref("/pit", orgId),
      },
    ];
  }

  if (input.shell === "empty" || batteryCount === 0) {
    return [
      {
        id: "add-battery",
        label: "Add a battery",
        detail: "Label and serial stay blank until you register a real pack.",
        href: "#br-add-battery",
        primary: true,
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Log IR and cycles on the Team Batteries board.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "battery-health-forecast",
        label: "Open Health Forecast",
        detail: "Retirement projections stay blank until packs exist.",
        href: hubHref("/build", "battery-health-forecast", orgId),
      },
      {
        id: "pit",
        label: "Open Pit Command",
        detail: "Event-day rack status uses the same real pack evidence.",
        href: withOrgHref("/pit", orgId),
      },
    ].slice(0, 4);
  }

  const actions: BatteryRotationNextAction[] = [];

  if (shortPackCount > 0) {
    actions.push({
      id: "short-packs",
      label: "Review short-pack alerts",
      detail: `${shortPackCount} pack${shortPackCount === 1 ? "" : "s"} flagged from real IR thresholds — bench before eliminations.`,
      href: "#br-fleet",
      primary: true,
    });
  } else if (chargeShortfallCount > 0) {
    actions.push({
      id: "charge-shortfalls",
      label: "Fix charge shortfalls",
      detail: `${chargeShortfallCount} assignment${chargeShortfallCount === 1 ? "" : "s"} lack a full charge window — adjust from real schedule gaps.`,
      href: "#br-schedule",
      primary: true,
    });
  } else if (upcomingAssignments === 0) {
    actions.push({
      id: "schedule",
      label: "Schedule a match assignment",
      detail: "Match labels and charge windows stay blank until you schedule a real pack.",
      href: "#br-schedule-form",
      primary: true,
    });
  } else {
    actions.push({
      id: "rotation",
      label: "Review rotation schedule",
      detail: `${batteryCount} real pack${batteryCount === 1 ? "" : "s"} · ${upcomingAssignments} upcoming assignment${upcomingAssignments === 1 ? "" : "s"}.`,
      href: "#br-schedule",
      primary: true,
    });
  }

  actions.push(
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "Log resistance tests and charge events on the Team Batteries board.",
      href: hubHref("/team", "batteries", orgId),
    },
    {
      id: "battery-health-forecast",
      label: "Open Health Forecast",
      detail: "Project pack retirement from the same IR + cycle history.",
      href: hubHref("/build", "battery-health-forecast", orgId),
    },
    {
      id: "pit",
      label: "Open Pit Command",
      detail: "Event-day rack status uses the same pack + log evidence.",
      href: withOrgHref("/pit", orgId),
    },
  );

  return actions.slice(0, 5);
}
