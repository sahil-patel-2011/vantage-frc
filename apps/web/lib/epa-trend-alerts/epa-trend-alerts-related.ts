import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Rating alerts (never DEMO EPA forecasts). */
export const EPA_TREND_ALERTS_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "opponent-watchlist", label: "Opponent Watchlist", tab: "opponent-watchlist" },
  { id: "scouting-heat-signals", label: "Scouting Heat", tab: "scouting-heat-signals" },
  { id: "counter-book", label: "Counter-book", tab: "counter-book" },
] as const;

export type EpaTrendAlertsRelatedId = (typeof EPA_TREND_ALERTS_RELATED_LINKS)[number]["id"];

export type EpaTrendAlertsRelatedLink = {
  id: EpaTrendAlertsRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Opponent Watchlist first. */
export const EPA_TREND_ALERTS_RELATED_INCLUDE: EpaTrendAlertsRelatedId[] = [
  "strategy",
  "opponent-watchlist",
];

/**
 * Soft-UI cross-links from Rating alerts → Strategy / Opponent Watchlist.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function epaTrendAlertsRelatedLinks(
  orgId?: string | null,
  options?: { active?: EpaTrendAlertsRelatedId; include?: EpaTrendAlertsRelatedId[] },
): EpaTrendAlertsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return EPA_TREND_ALERTS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type EpaTrendAlertsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type EpaTrendAlertsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type EpaTrendAlertsEmptyCopy = {
  kind: EpaTrendAlertsShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real watchlist / alert counts only — never invent DEMO EPA totals. */
export function formatEpaTrendMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is watched — avoids looking like DEMO counters. */
export function shouldShowEpaTrendSummaryTiles(watchlistCount: number): boolean {
  return watchlistCount > 0;
}

/** Classify Rating alerts Soft-UI shell — never invents DEMO EPA metrics. */
export function classifyEpaTrendAlertsShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  watchlistCount?: number;
}): EpaTrendAlertsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.watchlistCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO EPA forecasts. */
export function epaTrendAlertsShellCopy(kind: EpaTrendAlertsShellKind): EpaTrendAlertsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Rating alerts",
        description:
          "Checking which team you are on and watched teams.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Rating alerts",
        description:
          "A network or server issue blocked the watchlist. Retry, or open Strategy / Opponent Watchlist while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before watching teams.",
      };
    case "empty":
      return {
        kind,
        badge: "No teams watched",
        title: "Add a team to your watchlist",
        description:
          "Alerts stay blank until you watch a real team with season rating history. Cross-check Strategy and Opponent Watchlist.",
      };
    default:
      return {
        kind: "ready",
        title: "rating swings on watched teams",
        description:
          "Alerts use stored season rating between events for teams you watch.",
      };
  }
}

/**
 * Soft-UI next actions for Rating alerts empty/setup shells.
 * Points at Strategy / Opponent Watchlist — never invents DEMO EPA metrics.
 */
export function epaTrendAlertsNextActions(input: {
  orgId?: string | null;
  shell: EpaTrendAlertsShellKind;
  watchlistCount?: number;
  alertCount?: number;
}): EpaTrendAlertsNextAction[] {
  const orgId = input.orgId ?? null;
  const watchlistCount = input.watchlistCount ?? 0;
  const alertCount = input.alertCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before tracking rating swings.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "opponent-watchlist",
          label: "Open Watchlist",
          detail: "Manual opponent notes stay blank until logged.",
          href: hubHref("/competition", "opponent-watchlist", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Rating alerts can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before watching rating swings.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "opponent-watchlist",
        label: "Open Watchlist",
        detail: "Track opponents you already care about beside Rating alerts.",
        href: hubHref("/competition", "opponent-watchlist", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Rating alerts",
        detail: "Reload real watchlist rows.",
        href: withOrgHref("/epa-trend-alerts", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while alerts reload.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "opponent-watchlist",
        label: "Open Watchlist",
        detail: "Opponent notes stay available while alerts reload.",
        href: hubHref("/competition", "opponent-watchlist", orgId),
      },
    ];
  }

  if (input.shell === "empty" || watchlistCount === 0) {
    return [
      {
        id: "watch-team",
        label: "Watch a team",
        detail: "Add a team number below — alerts stay blank until season rating moves.",
        href: "#epa-trend-alerts-watch",
        primary: true,
      },
      {
        id: "strategy",
        label: "Cross-check Strategy",
        detail: "Pick lists use scouted and reference metrics only.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "opponent-watchlist",
        label: "Open Watchlist",
        detail: "Keep qualitative opponent notes beside quantitative rating swings.",
        href: hubHref("/competition", "opponent-watchlist", orgId),
      },
    ].slice(0, 4);
  }

  const actions: EpaTrendAlertsNextAction[] = [];

  if (alertCount > 0) {
    actions.push({
      id: "review-alerts",
      label: "Review active rating swings",
      detail: `${alertCount} alert${alertCount === 1 ? "" : "s"} from real event-to-event season rating — dismiss only after you acknowledge them.`,
      href: "#epa-trend-alerts-list",
      primary: true,
    });
  } else {
    actions.push({
      id: "watch-more",
      label: "Watch another team",
      detail: `${watchlistCount} watched — alerts appear only when season rating moves enough between events.`,
      href: "#epa-trend-alerts-watch",
      primary: true,
    });
  }

  actions.push(
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ground picks in scouted data and reference metrics.",
      href: hubHref("/competition", "strategy", orgId),
      primary: !actions.some((a) => a.primary),
    },
    {
      id: "opponent-watchlist",
      label: "Open Watchlist",
      detail: "Pair qualitative notes with quantitative rating swings.",
      href: hubHref("/competition", "opponent-watchlist", orgId),
    },
    {
      id: "scouting-heat-signals",
      label: "Open Heat signals",
      detail: "Field heat signals stay blank until real scout rows exist.",
      href: hubHref("/competition", "scouting-heat-signals", orgId),
    },
  );

  return actions.slice(0, 5);
}
