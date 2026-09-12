import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Collaborative Pick List (never DEMO ranks). */
export const PICKLIST_COLLAB_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "picklist-justifier", label: "Pick-list Justifier", tab: "picklist-justifier" },
  { id: "pick-clock", label: "Pick clock", tab: "pick-clock" },
  { id: "alliance-selection-desk", label: "Alliance desk", tab: "alliance-selection-desk" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
] as const;

export type PicklistCollabRelatedId = (typeof PICKLIST_COLLAB_RELATED_LINKS)[number]["id"];

export type PicklistCollabRelatedLink = {
  id: PicklistCollabRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Justifier / Pick clock. */
export const PICKLIST_COLLAB_RELATED_INCLUDE: PicklistCollabRelatedId[] = [
  "strategy",
  "picklist-justifier",
  "pick-clock",
];

/**
 * Soft-UI cross-links from Collaborative Pick List → Strategy / Justifier / Pick clock.
 * Build with hubHref — never broken JSX href templates.
 */
export function picklistCollabRelatedLinks(
  orgId?: string | null,
  options?: { active?: PicklistCollabRelatedId; include?: PicklistCollabRelatedId[] },
): PicklistCollabRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PICKLIST_COLLAB_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type PicklistCollabShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PicklistCollabNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type PicklistCollabEmptyCopy = {
  kind: PicklistCollabShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type PicklistCollabSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function picklistCollabRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    picklistCollabRelatedLinks(orgId, {
      include: [...PICKLIST_COLLAB_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = picklistCollabRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function picklistCollabSetupSteps(orgId?: string | null): PicklistCollabSetupStepLink[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open pick lists.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — ranks stay empty until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ]);
}

/** Real entry / vote counts only — never invent DEMO totals. */
export function formatPicklistCollabMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no teams are tracked — avoids DEMO counters. */
export function shouldShowPicklistCollabSummaryTiles(input: {
  listCount: number;
  totalEntries: number;
}): boolean {
  return input.listCount > 0 && input.totalEntries > 0;
}

/** Classify Collaborative Pick List Soft-UI shell — never invents DEMO ranks. */
export function classifyPicklistCollabShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  listCount?: number;
}): PicklistCollabShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.listCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO ranks. */
export function picklistCollabShellCopy(kind: PicklistCollabShellKind): PicklistCollabEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Collaborative Pick List…",
        description: "Checking which team you are on and pick lists.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Collaborative Pick List",
        description:
          "A network or server issue blocked the list. Retry, or open Strategy / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before ranking teams.",
      };
    case "empty":
      return {
        kind,
        badge: "No lists yet",
        title: "Create your first pick list",
        description:
          "Name a list for your event key, then add teams and cast weighted votes. Consensus stays blank until real votes exist.",
      };
    default:
      return {
        kind: "ready",
        title: "Collaborative pick consensus",
        description:
          "Tiers and weighted votes from your team only.",
      };
  }
}

/**
 * Soft-UI next actions for Collaborative Pick List empty/setup shells.
 * Points at Strategy / Justifier / Scouting — never invents DEMO ranks.
 */
export function picklistCollabNextActions(input: {
  orgId?: string | null;
  shell: PicklistCollabShellKind;
  listCount?: number;
  totalEntries?: number;
  totalVotes?: number;
}): PicklistCollabNextAction[] {
  const orgId = input.orgId ?? null;
  const listCount = input.listCount ?? 0;
  const totalEntries = input.totalEntries ?? 0;
  const totalVotes = input.totalVotes ?? 0;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of picklistCollabSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(picklistCollabSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Collaborative Pick List",
        detail: "Reload real lists.",
        href: withOrgHref("/picklist-collab", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the list reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the list reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || listCount === 0) {
    return [
      {
        id: "create",
        label: "Create pick list",
        detail: "Name a list and event key — teams stay blank until you add them.",
        href: "#picklist-collab-create",
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Ground ranks in scouted and reference metrics.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout observations strengthen consensus votes.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (totalEntries === 0) {
    return [
      {
        id: "add",
        label: "Add your first team",
        detail: "Once teams are added, anyone can cast a weighted vote.",
        href: "#picklist-collab-add",
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Match rows inform who belongs on the list.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "picklist-justifier",
        label: "Open Pick-list Justifier",
        detail: "Source-cited rationales after teams are ranked.",
        href: hubHref("/competition", "picklist-justifier", orgId),
      },
    ];
  }

  return [
    {
      id: "vote",
      label: totalVotes > 0 ? "Cast another vote" : "Cast the first vote",
      detail:
        totalVotes > 0
          ? `${totalVotes} vote${totalVotes === 1 ? "" : "s"} on file — consensus uses weighted scores only.`
          : `${totalEntries} team${totalEntries === 1 ? "" : "s"} tracked — votes stay blank until cast.`,
      href: "#picklist-collab-entries",
      primary: true,
    },
    {
      id: "picklist-justifier",
      label: "Open Pick-list Justifier",
      detail: "Generate source-cited rationales from this consensus.",
      href: hubHref("/competition", "picklist-justifier", orgId),
    },
    {
      id: "pick-clock",
      label: "Open Pick clock",
      detail: "Time-box live picks against this list.",
      href: hubHref("/competition", "pick-clock", orgId),
    },
    {
      id: "alliance-selection-desk",
      label: "Open Alliance desk",
      detail: "Carry consensus onto the live board.",
      href: hubHref("/competition", "alliance-selection-desk", orgId),
    },
  ];
}
