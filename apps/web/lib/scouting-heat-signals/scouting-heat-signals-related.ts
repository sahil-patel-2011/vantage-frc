import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Heat signals (never DEMO trend arrows). */
export const SCOUTING_HEAT_SIGNALS_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "opponent-watchlist", label: "Watchlist", tab: "opponent-watchlist" },
  { id: "picklist-collab", label: "Pick list", tab: "picklist-collab" },
  { id: "strategy", label: "Strategy", tab: "strategy" },
] as const;

export type ScoutingHeatSignalsRelatedId = (typeof SCOUTING_HEAT_SIGNALS_RELATED_LINKS)[number]["id"];

export type ScoutingHeatSignalsRelatedLink = {
  id: ScoutingHeatSignalsRelatedId;
  label: string;
  href: string;
};

export const SCOUTING_HEAT_SIGNALS_RELATED_INCLUDE: ScoutingHeatSignalsRelatedId[] = [
  "scouting",
  "opponent-watchlist",
  "picklist-collab",
];

/**
 * Soft-UI cross-links from Heat Signals → Scouting / Watchlist / Pick list.
 * Build with hubHref — never broken JSX href templates.
 */
export function scoutingHeatSignalsRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutingHeatSignalsRelatedId; include?: ScoutingHeatSignalsRelatedId[] },
): ScoutingHeatSignalsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUTING_HEAT_SIGNALS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type ScoutingHeatSignalsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutingHeatSignalsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutingHeatSignalsEmptyCopy = {
  kind: ScoutingHeatSignalsShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ScoutingHeatSignalsSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutingHeatSignalsSetupSteps(orgId?: string | null): ScoutingHeatSignalsSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open heat signals.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Log real match observations before trends can rise or fall.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "opponent-watchlist",
      label: "Open Watchlist",
      detail: "Track alliance targets that heat signals should inform.",
      href: hubHref("/competition", "opponent-watchlist", orgId),
    },
    {
      id: "picklist-collab",
      label: "Open Pick list",
      detail: "Carry rising/falling teams into alliance priorities.",
      href: hubHref("/competition", "picklist-collab", orgId),
    },
  ];
}

/** Real team / observation counts only — never invent DEMO totals. */
export function formatScoutingHeatSignalsMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no observations exist — avoids DEMO counters. */
export function shouldShowScoutingHeatSignalsSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

/** Classify Heat Signals Soft-UI shell — never invents DEMO trend arrows. */
export function classifyScoutingHeatSignalsShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): ScoutingHeatSignalsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.entryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO trend arrows. */
export function scoutingHeatSignalsShellCopy(kind: ScoutingHeatSignalsShellKind): ScoutingHeatSignalsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Heat signals",
        description: "Checking which team you are on and logged observations.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Heat signals",
        description:
          "A network or server issue blocked heat signals. Retry, or open Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before logging rising/falling teams.",
      };
    case "empty":
      return {
        kind,
        badge: "No observations yet",
        title: "Log your first heat signal",
        description:
          "Record a team as trending up or down after a real match.",
      };
    default:
      return {
        kind: "ready",
        title: "Scout-observed heat trends",
        description: "Rising and falling teams from logged observations only.",
      };
  }
}

/**
 * Soft-UI next actions for Heat Signals empty/setup shells.
 * Points at Scouting / Watchlist / Pick list — never invents DEMO trend arrows.
 */
export function scoutingHeatSignalsNextActions(input: {
  orgId?: string | null;
  shell: ScoutingHeatSignalsShellKind;
  entryCount?: number;
  risingCount?: number;
}): ScoutingHeatSignalsNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const risingCount = input.risingCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before logging trends.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Match rows stay blank until scouts log real observations.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "picklist-collab",
          label: "Open Pick list",
          detail: "Alliance priorities stay empty until your team ranks targets.",
          href: hubHref("/competition", "picklist-collab", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Heat Signals can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Log match observations that feed heat trends.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "opponent-watchlist",
        label: "Open Watchlist",
        detail: "Pin alliance targets heat signals should inform.",
        href: hubHref("/competition", "opponent-watchlist", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Heat Signals",
        detail: "Reload real observations.",
        href: withOrgHref("/scouting-heat-signals", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scouting stays available while heat signals reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "picklist-collab",
        label: "Open Pick list",
        detail: "Pick list stays available while heat signals reload.",
        href: hubHref("/competition", "picklist-collab", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "log-signal",
        label: "Log the first heat signal",
        detail: "Trends stay blank until scouts log real rising/falling notes.",
        href: "#scouting-heat-log",
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Carry match notes into heat observations.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "opponent-watchlist",
        label: "Open Watchlist",
        detail: "Watchlist targets stay blank until you pin real teams.",
        href: hubHref("/competition", "opponent-watchlist", orgId),
      },
    ];
  }

  return [
    {
      id: risingCount > 0 ? "review-rising" : "review-heat",
      label: risingCount > 0 ? "Review rising teams" : "Review heat signals",
      detail:
        risingCount > 0
          ? `${risingCount} team${risingCount === 1 ? "" : "s"} trending up from real observations.`
          : `${entryCount} observation${entryCount === 1 ? "" : "s"} logged.`,
      href: "#scouting-heat-list",
      primary: true,
    },
    {
      id: "picklist-collab",
      label: "Open Pick list",
      detail: "Fold rising/falling teams into alliance priorities.",
      href: hubHref("/competition", "picklist-collab", orgId),
    },
    {
      id: "opponent-watchlist",
      label: "Open Watchlist",
      detail: "Cross-check heat against watched opponents.",
      href: hubHref("/competition", "opponent-watchlist", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Carry heat into match strategy.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ];
}
