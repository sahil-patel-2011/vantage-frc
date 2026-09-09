import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Match-Delta Watcher (never DEMO upset %). */
export const MATCH_DELTA_WATCHER_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "picklist-collab", label: "Pick List", tab: "picklist-collab" },
  { id: "match-strategy-cards", label: "Strategy Cards", tab: "match-strategy-cards" },
  { id: "command", label: "Command", tab: "command" },
] as const;

export type MatchDeltaWatcherRelatedId = (typeof MATCH_DELTA_WATCHER_RELATED_LINKS)[number]["id"];

export type MatchDeltaWatcherRelatedLink = {
  id: MatchDeltaWatcherRelatedId;
  label: string;
  href: string;
};

export const MATCH_DELTA_WATCHER_RELATED_INCLUDE: MatchDeltaWatcherRelatedId[] = [
  "strategy",
  "picklist-collab",
  "command",
];

/**
 * Soft-UI cross-links from Match-Delta Watcher → Strategy / Pick List / Command.
 * Build with hubHref — never broken JSX href templates.
 */
export function matchDeltaWatcherRelatedLinks(
  orgId?: string | null,
  options?: { active?: MatchDeltaWatcherRelatedId; include?: MatchDeltaWatcherRelatedId[] },
): MatchDeltaWatcherRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MATCH_DELTA_WATCHER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type MatchDeltaWatcherShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MatchDeltaWatcherNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MatchDeltaWatcherEmptyCopy = {
  kind: MatchDeltaWatcherShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type MatchDeltaWatcherSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function matchDeltaWatcherSetupSteps(orgId?: string | null): MatchDeltaWatcherSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — match deltas are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Score real predictions so official results have something to diverge from.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "picklist-collab",
      label: "Open Pick List",
      detail: "Priorities stay blank until your team ranks real alliance targets.",
      href: hubHref("/competition", "picklist-collab", orgId),
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Confirm the active event so TBA results can land against predictions.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}

/** Real watched-match / alert counts only — never invent DEMO totals. */
export function formatMatchDeltaWatcherMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Accuracy from real scored predictions — em dash until matches exist; never DEMO %. */
export function formatMatchDeltaWatcherRate(
  value: unknown,
  loaded: boolean,
  options?: { hasWatched?: boolean },
): string {
  if (!loaded) return "…";
  if (options?.hasWatched === false) return "—";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(n * 100)}%`;
}

/** Hide zeroed summary tiles when nothing has been watched — avoids DEMO counters. */
export function shouldShowMatchDeltaWatcherSummaryTiles(watchedCount: number): boolean {
  return watchedCount > 0;
}

/** Classify Match-Delta Watcher Soft-UI shell — never invents DEMO upset alerts. */
export function classifyMatchDeltaWatcherShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  watchedCount?: number;
}): MatchDeltaWatcherShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.watchedCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO upset %. */
export function matchDeltaWatcherShellCopy(kind: MatchDeltaWatcherShellKind): MatchDeltaWatcherEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Match-Delta Watcher…",
        description: "Checking workspace membership and scored predictions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Match-Delta Watcher",
        description:
          "A network or server issue blocked the watcher. Retry, or open Strategy while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Match-Delta Watcher is org-scoped. Pick a workspace before comparing official results to predictions — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No matches watched yet",
        title: "Score predictions, then scan",
        description:
          "Official results flag divergences only after real predictions exist for this event.",
      };
    default:
      return {
        kind: "ready",
        title: "Official results vs predictions",
        description: "Alerts from scored matches only.",
      };
  }
}

/**
 * Soft-UI next actions for Match-Delta Watcher empty/setup shells.
 * Points at Strategy / Pick List / Command — never invents DEMO upset alerts.
 */
export function matchDeltaWatcherNextActions(input: {
  orgId?: string | null;
  shell: MatchDeltaWatcherShellKind;
  watchedCount?: number;
  unacknowledgedCount?: number;
}): MatchDeltaWatcherNextAction[] {
  const orgId = input.orgId ?? null;
  const watchedCount = input.watchedCount ?? 0;
  const unacknowledgedCount = input.unacknowledgedCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Match deltas are org-scoped — pick a team before scanning results.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Predictions stay blank until your team scores real matches.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "command",
          label: "Open Command",
          detail: "Event Day stays blank until a real event is pinned.",
          href: hubHref("/competition", "command", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Match-Delta Watcher can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Score predictions before official results can diverge.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "picklist-collab",
        label: "Open Pick List",
        detail: "Alliance priorities feed pick-list upset alerts.",
        href: hubHref("/competition", "picklist-collab", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Match-Delta Watcher",
        detail: "Reload real scored matches — nothing is invented while this fails.",
        href: withOrgHref("/match-delta-watcher", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Strategy stays available while the watcher reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Event Day stays available while the watcher reloads.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "empty" || watchedCount === 0) {
    return [
      {
        id: "strategy",
        label: "Score predictions",
        detail: "Watched matches stay blank until Strategy has real scored rows.",
        href: hubHref("/competition", "strategy", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Command",
        detail: "Confirm the active event so TBA results can land.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "picklist-collab",
        label: "Open Pick List",
        detail: "Rank alliance targets so pick-list upsets can surface.",
        href: hubHref("/competition", "picklist-collab", orgId),
      },
    ];
  }

  return [
    {
      id: unacknowledgedCount > 0 ? "ack-alerts" : "scan-deltas",
      label: unacknowledgedCount > 0 ? "Review unacknowledged alerts" : "Scan for new deltas",
      detail:
        unacknowledgedCount > 0
          ? `${unacknowledgedCount} unacknowledged alert${unacknowledgedCount === 1 ? "" : "s"} from real results.`
          : `${watchedCount} watched match${watchedCount === 1 ? "" : "es"} from scored predictions.`,
      href: unacknowledgedCount > 0 ? "#match-delta-alerts" : "#match-delta-scan",
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Refresh predictions beside official results.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "picklist-collab",
      label: "Open Pick List",
      detail: "Cross-check alliance priorities against upset alerts.",
      href: hubHref("/competition", "picklist-collab", orgId),
    },
    {
      id: "command",
      label: "Open Command",
      detail: "Carry deltas into event-day ops.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}
