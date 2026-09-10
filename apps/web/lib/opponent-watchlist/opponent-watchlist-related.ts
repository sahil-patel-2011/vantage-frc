import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Opponent Watchlist (never DEMO opponent metrics). */
export const OPPONENT_WATCHLIST_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "epa-trend-alerts", label: "EPA Trend Alerts", tab: "epa-trend-alerts" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "scouting-heat-signals", label: "Scouting Heat", tab: "scouting-heat-signals" },
  { id: "counter-book", label: "Counter-book", tab: "counter-book" },
] as const;

export type OpponentWatchlistRelatedId = (typeof OPPONENT_WATCHLIST_RELATED_LINKS)[number]["id"];

export type OpponentWatchlistRelatedLink = {
  id: OpponentWatchlistRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / EPA Trend Alerts / Scouting first. */
export const OPPONENT_WATCHLIST_RELATED_INCLUDE: OpponentWatchlistRelatedId[] = [
  "strategy",
  "epa-trend-alerts",
  "scouting",
];

/**
 * Soft-UI cross-links from Opponent Watchlist → Strategy / EPA alerts / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function opponentWatchlistRelatedLinks(
  orgId?: string | null,
  options?: { active?: OpponentWatchlistRelatedId; include?: OpponentWatchlistRelatedId[] },
): OpponentWatchlistRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return OPPONENT_WATCHLIST_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type OpponentWatchlistShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type OpponentWatchlistNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type OpponentWatchlistEmptyCopy = {
  kind: OpponentWatchlistShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Real watchlist / alert counts only — never invent DEMO opponent totals. */
export function formatOpponentWatchlistMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is watched — avoids looking like DEMO counters. */
export function shouldShowOpponentWatchlistSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

/** Classify Opponent Watchlist Soft-UI shell — never invents DEMO opponent metrics. */
export function classifyOpponentWatchlistShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): OpponentWatchlistShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (!input.orgId || input.status === "setup_required") return "setup";
  if ((input.entryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO opponent metrics. */
export function opponentWatchlistShellCopy(kind: OpponentWatchlistShellKind): OpponentWatchlistEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Opponent Watchlist…",
        description:
          "Checking which team you are on and watched opponents.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Opponent Watchlist",
        description:
          "A network or server issue blocked the watchlist. Retry, or open Strategy / EPA Trend Alerts / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team",
        description:
          "Select a team before watching opponents.",
      };
    case "empty":
      return {
        kind,
        badge: "Empty watchlist",
        title: "Add your first opponent to watch",
        description:
          "The board stays blank until you watch a real team. Cross-check Strategy, EPA Trend Alerts, and Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "Personal opponent watchlist",
        description:
          "Alerts use only reference EPA and scheduled matches for teams you watch.",
      };
  }
}

/**
 * Soft-UI next actions for Opponent Watchlist empty/setup shells.
 * Points at Strategy / EPA Trend Alerts / Scouting — never invents DEMO opponent metrics.
 */
export function opponentWatchlistNextActions(input: {
  orgId?: string | null;
  shell: OpponentWatchlistShellKind;
  entryCount?: number;
  alertCount?: number;
}): OpponentWatchlistNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const alertCount = input.alertCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before tracking opponents.",
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
          id: "epa-trend-alerts",
          label: "Open EPA Trend Alerts",
          detail: "EPA swings stay blank until you watch real teams.",
          href: hubHref("/competition", "epa-trend-alerts", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout rows stay blank until your team enters them.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Opponent Watchlist can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before watching opponents.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "epa-trend-alerts",
        label: "Open EPA Trend Alerts",
        detail: "Pair quantitative EPA swings with personal opponent notes.",
        href: hubHref("/competition", "epa-trend-alerts", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Ground opponent notes in real scout rows.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Opponent Watchlist",
        detail: "Reload real watchlist rows.",
        href: withOrgHref("/opponent-watchlist", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the watchlist reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "epa-trend-alerts",
        label: "Open EPA Trend Alerts",
        detail: "EPA alerts stay available while the watchlist reloads.",
        href: hubHref("/competition", "epa-trend-alerts", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the watchlist reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "watch-team",
        label: "Watch a team",
        detail: "Add a team key below — alerts stay blank until EPA or schedule moves.",
        href: "#opponent-watchlist-watch",
        primary: true,
      },
      {
        id: "strategy",
        label: "Cross-check Strategy",
        detail: "Pick lists use scouted and reference metrics only.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "epa-trend-alerts",
        label: "Open EPA Trend Alerts",
        detail: "Org-shared EPA swings complement personal opponent notes.",
        href: hubHref("/competition", "epa-trend-alerts", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Field observations stay blank until real scout rows exist.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ].slice(0, 4);
  }

  const actions: OpponentWatchlistNextAction[] = [];

  if (alertCount > 0) {
    actions.push({
      id: "review-alerts",
      label: "Review watchlist alerts",
      detail: `${alertCount} alert${alertCount === 1 ? "" : "s"} from real EPA or schedule changes.`,
      href: "#opponent-watchlist-alerts",
      primary: true,
    });
  } else {
    actions.push({
      id: "watch-more",
      label: "Watch another team",
      detail: `${entryCount} watched — alerts appear only when reference EPA or next match changes.`,
      href: "#opponent-watchlist-watch",
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
      id: "epa-trend-alerts",
      label: "Open EPA Trend Alerts",
      detail: "Pair qualitative notes with quantitative EPA swings.",
      href: hubHref("/competition", "epa-trend-alerts", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Field heat and scout rows stay blank until real data exists.",
      href: hubHref("/competition", "scouting", orgId),
    },
  );

  return actions.slice(0, 5);
}
