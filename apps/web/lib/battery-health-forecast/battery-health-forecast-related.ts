import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Pack health (never DEMO IR / EOL metrics). */
export const BATTERY_HEALTH_FORECAST_RELATED_LINKS = [
  {
    id: "battery-rotation",
    label: "Charge plan",
    kind: "competition" as const,
    tab: "battery-rotation",
  },
  { id: "batteries", label: "Batteries", kind: "team" as const, tab: "batteries" },
  { id: "pit", label: "Pit Command", kind: "path" as const, path: "/pit" },
  {
    id: "battery-health-forecast",
    label: "Pack health",
    kind: "build" as const,
    tab: "battery-health-forecast",
  },
] as const;

export type BatteryHealthForecastRelatedId =
  (typeof BATTERY_HEALTH_FORECAST_RELATED_LINKS)[number]["id"];

export type BatteryHealthForecastRelatedLink = {
  id: BatteryHealthForecastRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Charge plan / Batteries / Pit first. */
export const BATTERY_HEALTH_FORECAST_RELATED_INCLUDE: BatteryHealthForecastRelatedId[] = [
  "battery-rotation",
  "batteries",
  "pit",
];

/**
 * Soft-UI cross-links from Pack health → Rotation / Batteries / Pit.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function batteryHealthForecastRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: BatteryHealthForecastRelatedId;
    include?: BatteryHealthForecastRelatedId[];
  },
): BatteryHealthForecastRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return BATTERY_HEALTH_FORECAST_RELATED_LINKS.filter((link) => {
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

export type BatteryHealthForecastShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type BatteryHealthForecastNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type BatteryHealthForecastEmptyCopy = {
  kind: BatteryHealthForecastShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO IR or EOL metrics. */
export type BatteryHealthForecastSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function batteryHealthForecastSetupSteps(
  orgId?: string | null,
): BatteryHealthForecastSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Pack health.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "battery-rotation",
      label: "Open Charge plan",
      detail: "Match assignments stay blank until packs exist.",
      href: hubHref("/competition", "battery-rotation", orgId),
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "IR, voltage, and cycles stay blank until you log them.",
      href: hubHref("/team", "batteries", orgId),
    },
    {
      id: "pit",
      label: "Open Pit Command",
      detail: "Event-day rack status uses the same real pack evidence.",
      href: withOrgHref("/pit", orgId),
    },
  ];
}

/** Real fleet / forecast counts only — never invent DEMO IR or EOL totals. */
export function formatBatteryHealthForecastMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Fleet readiness percent from real forecasts only — blank when no scored packs. */
export function formatBatteryHealthForecastReadiness(
  value: unknown,
  loaded: boolean,
  scoredPackCount: number,
): string {
  if (!loaded || scoredPackCount <= 0) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed summary tiles when no batteries exist — avoids DEMO counters. */
export function shouldShowBatteryHealthForecastSummaryTiles(batteryCount: number): boolean {
  return batteryCount > 0;
}

/** Classify Pack health Soft-UI shell — never invents DEMO IR / EOL metrics. */
export function classifyBatteryHealthForecastShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  batteryCount?: number;
}): BatteryHealthForecastShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.batteryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO IR or EOL metrics. */
export function batteryHealthForecastShellCopy(
  kind: BatteryHealthForecastShellKind,
): BatteryHealthForecastEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Pack health",
        description:
          "Checking which team you are on and real IR / cycle logs.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Pack health",
        description:
          "A network or server issue blocked the forecast. Retry, or open Charge plan / Batteries / Pit while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before projecting retirement from real logs.",
      };
    case "empty":
      return {
        kind,
        badge: "No batteries yet",
        title: "Add a pack before forecasting end-of-life",
        description:
          "Retirement dates stay blank until you register a pack and log IR + cycle readings. Cross-check Charge plan, Batteries, and Pit.",
      };
    default:
      return {
        kind: "ready",
        title: "Battery end-of-life forecast",
        description:
          "Projections use only logged cycle counts and internal-resistance trends.",
      };
  }
}

/**
 * Soft-UI next actions for Pack health empty/setup shells.
 * Points at Charge plan / Batteries / Pit — never invents DEMO IR or EOL metrics.
 */
export function batteryHealthForecastNextActions(input: {
  orgId?: string | null;
  shell: BatteryHealthForecastShellKind;
  batteryCount?: number;
  insufficientDataCount?: number;
  watchCount?: number;
  retireSoonCount?: number;
  overdueCount?: number;
}): BatteryHealthForecastNextAction[] {
  const orgId = input.orgId ?? null;
  const batteryCount = input.batteryCount ?? 0;
  const insufficientDataCount = input.insufficientDataCount ?? 0;
  const watchCount = input.watchCount ?? 0;
  const retireSoonCount = input.retireSoonCount ?? 0;
  const overdueCount = input.overdueCount ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of batteryHealthForecastSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(batteryHealthForecastSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Pack health",
        detail: "Reload real IR / cycle forecasts.",
        href: withOrgHref("/battery-health-forecast", orgId),
        primary: true,
      },
      {
        id: "battery-rotation",
        label: "Open Charge plan",
        detail: "Charge plans stay available while the forecast reloads.",
        href: hubHref("/competition", "battery-rotation", orgId),
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Pack logs stay available while the forecast reloads.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "pit",
        label: "Open Pit Command",
        detail: "Pit rack status stays available while the forecast reloads.",
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
        href: "#bhf-add-battery",
        primary: true,
      },
      {
        id: "battery-rotation",
        label: "Open Charge plan",
        detail: "Match assignments stay blank until packs exist.",
        href: hubHref("/competition", "battery-rotation", orgId),
      },
      {
        id: "batteries",
        label: "Open Batteries",
        detail: "Log IR and cycles on the Team Batteries board.",
        href: hubHref("/team", "batteries", orgId),
      },
      {
        id: "pit",
        label: "Open Pit Command",
        detail: "Event-day rack status uses the same real pack evidence.",
        href: withOrgHref("/pit", orgId),
      },
    ].slice(0, 4);
  }

  const actions: BatteryHealthForecastNextAction[] = [];

  if (overdueCount > 0) {
    actions.push({
      id: "overdue",
      label: "Review overdue packs",
      detail: `${overdueCount} pack${overdueCount === 1 ? "" : "s"} past projected retirement — retire from real IR trends.`,
      href: "#bhf-forecast",
      primary: true,
    });
  } else if (retireSoonCount > 0) {
    actions.push({
      id: "retire-soon",
      label: "Review retire-soon packs",
      detail: `${retireSoonCount} pack${retireSoonCount === 1 ? "" : "s"} approaching the IR threshold — plan rotation before eliminations.`,
      href: "#bhf-forecast",
      primary: true,
    });
  } else if (watchCount > 0) {
    actions.push({
      id: "watch",
      label: "Watch rising IR packs",
      detail: `${watchCount} pack${watchCount === 1 ? "" : "s"} on watch from logged resistance trends.`,
      href: "#bhf-forecast",
      primary: true,
    });
  } else if (insufficientDataCount > 0) {
    actions.push({
      id: "log-reading",
      label: "Log more IR readings",
      detail: `${insufficientDataCount} pack${insufficientDataCount === 1 ? "" : "s"} need enough cycle/IR history before a projection appears.`,
      href: "#bhf-log-reading",
      primary: true,
    });
  } else {
    actions.push({
      id: "forecast",
      label: "Review fleet forecast",
      detail: `${batteryCount} real pack${batteryCount === 1 ? "" : "s"} — keep IR and cycle logs current.`,
      href: "#bhf-forecast",
      primary: true,
    });
  }

  actions.push(
    {
      id: "battery-rotation",
      label: "Open Charge plan",
      detail: "Schedule which pack runs which match from the same fleet.",
      href: hubHref("/competition", "battery-rotation", orgId),
    },
    {
      id: "batteries",
      label: "Open Batteries",
      detail: "Log resistance tests and charge events on the Team Batteries board.",
      href: hubHref("/team", "batteries", orgId),
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
