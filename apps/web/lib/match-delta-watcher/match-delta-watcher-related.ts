import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Soft-UI related surfaces for Match delta (never DEMO upset %). */
export const MATCH_DELTA_WATCHER_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "picklist-collab", label: "Pick list", tab: "picklist-collab" },
  { id: "match-strategy-cards", label: "Match cards", tab: "match-strategy-cards" },
  { id: "command", label: "Event day", tab: "command" },
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
 * Soft-UI cross-links from Match delta → Strategy / Pick list / Event day.
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

function matchDeltaWatcherRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    matchDeltaWatcherRelatedLinks(orgId, {
      include: [...MATCH_DELTA_WATCHER_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = matchDeltaWatcherRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function matchDeltaWatcherSetupSteps(orgId?: string | null): MatchDeltaWatcherSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open match deltas.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "team-data",
      label: "Sync Team data",
      detail: "Pull official results so deltas can appear.",
      href: withOrgHref("/team/data", orgId),
    },
  ]);
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

/** Classify Match delta Soft-UI shell — never invents DEMO upset alerts. */
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
        title: "Opening Match delta",
        description: "Checking which team you are on and scored predictions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Match delta",
        description:
          "A network or server issue blocked the watcher. Retry, or open Strategy while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before comparing official results to predictions.",
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
 * Soft-UI next actions for Match delta empty/setup shells.
 * Points at Strategy / Pick list / Event day — never invents DEMO upset alerts.
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
    return setupActionsFrom(matchDeltaWatcherSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Match delta",
        detail: "Reload real scored matches.",
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
        label: "Open Event day",
        detail: "Event day stays available while the watcher reloads.",
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
        label: "Open Event day",
        detail: "Confirm the active event so official results can land.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "picklist-collab",
        label: "Open Pick list",
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
      label: "Open Pick list",
      detail: "Cross-check alliance priorities against upset alerts.",
      href: hubHref("/competition", "picklist-collab", orgId),
    },
    {
      id: "command",
      label: "Open Event day",
      detail: "Carry deltas into event-day ops.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}
