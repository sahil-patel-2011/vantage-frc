import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Soft-UI related surfaces for Match cards (never DEMO game plans). */
export const MATCH_STRATEGY_CARDS_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "match-checklist", label: "Match checklist", tab: "match-checklist" },
  { id: "command", label: "Event day", tab: "command" },
  { id: "briefing", label: "Briefing", tab: "briefing" },
  { id: "defense-planner", label: "Defense", tab: "defense-planner" },
  { id: "drive-team-signals", label: "Drive-team board", tab: "drive-team-signals" },
] as const;

export type MatchStrategyCardsRelatedId =
  (typeof MATCH_STRATEGY_CARDS_RELATED_LINKS)[number]["id"];

export type MatchStrategyCardsRelatedLink = {
  id: MatchStrategyCardsRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Checklist / Event day. */
export const MATCH_STRATEGY_CARDS_RELATED_INCLUDE: MatchStrategyCardsRelatedId[] = [
  "strategy",
  "match-checklist",
  "command",
  "briefing",
];

/**
 * Soft-UI cross-links from Match cards → Strategy / Checklist / Event day.
 * Build with hubHref — never broken JSX href templates.
 */
export function matchStrategyCardsRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: MatchStrategyCardsRelatedId;
    include?: MatchStrategyCardsRelatedId[];
  },
): MatchStrategyCardsRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MATCH_STRATEGY_CARDS_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type MatchStrategyCardsShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MatchStrategyCardsNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MatchStrategyCardsEmptyCopy = {
  kind: MatchStrategyCardsShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type MatchStrategyCardsSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function matchStrategyCardsRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    matchStrategyCardsRelatedLinks(orgId, {
      include: [...MATCH_STRATEGY_CARDS_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = matchStrategyCardsRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function matchStrategyCardsSetupSteps(
  orgId?: string | null,
): MatchStrategyCardsSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open strategy cards.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "team-data",
      label: "Sync Team data",
      detail: "Load this event’s match schedule so cards can appear.",
      href: withOrgHref("/team/data", orgId),
    },
  ]);
}

/** Real card / saved counts only — never invent DEMO totals. */
export function formatMatchStrategyCardsMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no matches exist — avoids DEMO counters. */
export function shouldShowMatchStrategyCardsSummaryTiles(cardCount: number): boolean {
  return cardCount > 0;
}

/** Classify Match cards Soft-UI shell — never invents DEMO game plans. */
export function classifyMatchStrategyCardsShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  cardCount?: number;
}): MatchStrategyCardsShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.cardCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO game plans. */
export function matchStrategyCardsShellCopy(
  kind: MatchStrategyCardsShellKind,
): MatchStrategyCardsEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Match cards",
        description:
          "Checking which team you are on and scheduled matches.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Match cards",
        description:
          "A network or server issue blocked the schedule. Retry, or open Strategy / Event day while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and active event before drafting plans.",
      };
    case "empty":
      return {
        kind,
        badge: "No matches yet",
        title: "Waiting on a synced match schedule",
        description:
          "Cards appear once the schedule is synced for your active event. Plans stay blank until your drive team writes them.",
      };
    default:
      return {
        kind: "ready",
        title: "Printable per-match game plans",
        description:
          "Roles, auto, defense focus, and threats from your drive team only.",
      };
  }
}

/**
 * Soft-UI next actions for Match cards empty/setup shells.
 * Points at Strategy / Checklist / Command — never invents DEMO game plans.
 */
export function matchStrategyCardsNextActions(input: {
  orgId?: string | null;
  shell: MatchStrategyCardsShellKind;
  cardCount?: number;
  savedCount?: number;
  needsAutoCoordination?: boolean;
  needsAutoFlexibility?: boolean;
  needsDeploySafety?: boolean;
}): MatchStrategyCardsNextAction[] {
  const orgId = input.orgId ?? null;
  const cardCount = input.cardCount ?? 0;
  const savedCount = input.savedCount ?? 0;
  const needsAutoCoordination = Boolean(input.needsAutoCoordination);
  const needsAutoFlexibility = Boolean(input.needsAutoFlexibility);
  const needsDeploySafety = Boolean(input.needsDeploySafety);

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(matchStrategyCardsSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Match cards",
        detail: "Reload real schedule cards.",
        href: withOrgHref("/match-strategy-cards", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while cards reload.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "command",
        label: "Open Event day",
        detail: "Event day stays available while cards reload.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "empty" || cardCount === 0) {
    return [
      {
        id: "strategy",
        label: "Sync event schedule",
        detail: "Cards stay blank until matches exist for your active event.",
        href: hubHref("/competition", "strategy", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event day",
        detail: "Confirm the active event and next match.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "match-checklist",
        label: "Open Match checklist",
        detail: "Prep checklists while waiting on schedule sync.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
    ];
  }

  if (needsAutoCoordination) {
    return [
      {
        id: "auto-coord",
        label: "Agree autos with partners",
        detail:
          "Alliance partners are listed and Auto assignment is still blank — fill the spoken path plan before you queue.",
        href: "#match-strategy-cards-list",
        primary: true,
      },
      {
        id: "edit",
        label: savedCount > 0 ? "Update a strategy card" : "Draft the first card",
        detail:
          savedCount > 0
            ? `${savedCount} of ${cardCount} card${cardCount === 1 ? "": "s"} saved — print packs for drive team.`
            : `${cardCount} scheduled match${cardCount === 1 ? "" : "es"} — plans stay blank until you write them.`,
        href: "#match-strategy-cards-list",
      },
      {
        id: "match-checklist",
        label: "Open Match checklist",
        detail: "Pair printable cards with pre-match checklists.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
    ];
  }

  if (needsAutoFlexibility) {
    return [
      {
        id: "auto-flex",
        label: "Add a backup auto",
        detail:
          "Partners are listed and Auto is a single path — write a backup for common alliance layouts before you queue.",
        href: "#match-strategy-cards-list",
        primary: true,
      },
      {
        id: "edit",
        label: savedCount > 0 ? "Update a strategy card" : "Draft the first card",
        detail: "Keep the spoken plan flexible.",
        href: "#match-strategy-cards-list",
      },
      {
        id: "match-checklist",
        label: "Open Match checklist",
        detail: "Pair printable cards with pre-match checklists.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
    ];
  }

  if (needsDeploySafety) {
    return [
      {
        id: "deploy-safe",
        label: "Write deploy vs stow",
        detail:
          "A card mentions a hood, hopper, or deploy without when to stow — raised mechanisms get crushed under contact.",
        href: "#match-strategy-cards-list",
        primary: true,
      },
      {
        id: "edit",
        label: savedCount > 0 ? "Update a strategy card" : "Draft the first card",
        detail: "Driver notes stay blank until you write them.",
        href: "#match-strategy-cards-list",
      },
      {
        id: "match-checklist",
        label: "Open Match checklist",
        detail: "Pair printable cards with pre-match checklists.",
        href: hubHref("/competition", "match-checklist", orgId),
      },
    ];
  }

  return [
    {
      id: "edit",
      label: savedCount > 0 ? "Update a strategy card" : "Draft the first card",
      detail:
        savedCount > 0
          ? `${savedCount} of ${cardCount} card${cardCount === 1 ? "": "s"} saved — print packs for drive team.`
          : `${cardCount} scheduled match${cardCount === 1 ? "" : "es"} — plans stay blank until you write them.`,
      href: "#match-strategy-cards-list",
      primary: true,
    },
    {
      id: "match-checklist",
      label: "Open Match checklist",
      detail: "Pair printable cards with pre-match checklists.",
      href: hubHref("/competition", "match-checklist", orgId),
    },
    {
      id: "defense-planner",
      label: "Open Defense",
      detail: "Ground defense focus in scouted matchups.",
      href: hubHref("/competition", "defense-planner", orgId),
    },
    {
      id: "drive-team-signals",
      label: "Open Drive-team board",
      detail: "Carry live signals onto the field with the printed pack.",
      href: hubHref("/competition", "drive-team-signals", orgId),
    },
    {
      id: "briefing",
      label: "Open Briefing",
      detail:
        "This next-match card exports auto / backup / deploy cues from written text.",
      href: hubHref("/competition", "briefing", orgId),
    },
  ];
}
