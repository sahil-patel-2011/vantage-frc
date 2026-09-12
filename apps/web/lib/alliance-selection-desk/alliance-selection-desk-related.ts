import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Soft-UI related surfaces for Alliance desk (never DEMO rankings). */
export const ALLIANCE_SELECTION_DESK_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "picklist-collab", label: "Collaborative Pick List", tab: "picklist-collab" },
  { id: "pick-clock", label: "Pick clock", tab: "pick-clock" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "chemistry", label: "Chemistry", tab: "chemistry" },
] as const;

export type AllianceSelectionDeskRelatedId =
  (typeof ALLIANCE_SELECTION_DESK_RELATED_LINKS)[number]["id"];

export type AllianceSelectionDeskRelatedLink = {
  id: AllianceSelectionDeskRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Pick list / Pick clock. */
export const ALLIANCE_SELECTION_DESK_RELATED_INCLUDE: AllianceSelectionDeskRelatedId[] = [
  "strategy",
  "picklist-collab",
  "pick-clock",
];

/**
 * Soft-UI cross-links from Alliance desk → Strategy / Pick tools.
 * Build with hubHref — never broken JSX href templates.
 */
export function allianceSelectionDeskRelatedLinks(
  orgId?: string | null,
  options?: {
    active?: AllianceSelectionDeskRelatedId;
    include?: AllianceSelectionDeskRelatedId[];
  },
): AllianceSelectionDeskRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return ALLIANCE_SELECTION_DESK_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type AllianceSelectionDeskShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type AllianceSelectionDeskNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type AllianceSelectionDeskEmptyCopy = {
  kind: AllianceSelectionDeskShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type AllianceSelectionDeskSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function allianceSelectionDeskRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    allianceSelectionDeskRelatedLinks(orgId, {
      include: [...ALLIANCE_SELECTION_DESK_RELATED_INCLUDE],
    }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = allianceSelectionDeskRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function allianceSelectionDeskSetupSteps(
  orgId?: string | null,
): AllianceSelectionDeskSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open the alliance board.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — slots stay empty until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ]);
}

/** Real conflict / fill counts only — never invent DEMO totals. */
export function formatAllianceSelectionDeskMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no sessions exist — avoids DEMO counters. */
export function shouldShowAllianceSelectionDeskSummaryTiles(sessionCount: number): boolean {
  return sessionCount > 0;
}

/** True when the team has no desk sessions yet — Soft-UI empty. */
export function isAllianceSelectionDeskEmpty(input: { sessionCount: number }): boolean {
  return input.sessionCount === 0;
}

/** Classify Alliance desk Soft-UI shell — never invents DEMO rankings. */
export function classifyAllianceSelectionDeskShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "empty" | "live" | null;
  orgId?: string | null;
}): AllianceSelectionDeskShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (input.status === "empty") return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO rankings. */
export function allianceSelectionDeskShellCopy(
  kind: AllianceSelectionDeskShellKind,
): AllianceSelectionDeskEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening Alliance desk",
        description:
          "Checking which team you are on and desk sessions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Alliance desk",
        description:
          "A network or server issue blocked the board. Retry, or open Strategy / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before creating a live board.",
      };
    case "empty":
      return {
        kind,
        badge: "No sessions",
        title: "Create a selection desk session",
        description:
          "Open an 8-alliance live board for your active event. Slots stay empty until you assign real teams.",
      };
    default:
      return {
        kind: "ready",
        title: "Live alliance selection board",
        description:
          "Shared slots, scout evidence, and ranking conflict flags.",
      };
  }
}

/**
 * Soft-UI next actions for Alliance desk empty/setup shells.
 * Points at Strategy / Pick list / Scouting — never invents DEMO rankings.
 */
export function allianceSelectionDeskNextActions(input: {
  orgId?: string | null;
  shell: AllianceSelectionDeskShellKind;
  conflictCount?: number;
  filledSlots?: number;
}): AllianceSelectionDeskNextAction[] {
  const orgId = input.orgId ?? null;
  const conflictCount = input.conflictCount ?? 0;
  const filledSlots = input.filledSlots ?? 0;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(allianceSelectionDeskSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Alliance desk",
        detail: "Reload real sessions.",
        href: withOrgHref("/alliance-selection-desk", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the desk reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the desk reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "create",
        label: "Create desk session",
        detail: "Start an 8-alliance live board for your active event — slots stay empty until assigned.",
        href: "#alliance-desk-create",
        primary: true,
      },
      {
        id: "picklist-collab",
        label: "Open Collaborative Pick List",
        detail: "Co-rank partners before selection starts.",
        href: hubHref("/competition", "picklist-collab", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout evidence attaches to slots.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (conflictCount > 0) {
    return [
      {
        id: "conflicts",
        label: "Resolve conflict flags",
        detail: `${conflictCount} conflict flag${conflictCount === 1 ? "" : "s"} from ranking and scout overlap.`,
        href: "#alliance-desk-board",
        primary: true,
      },
      {
        id: "pick-clock",
        label: "Open Pick clock",
        detail: "Time-box the next pick with real list data only.",
        href: hubHref("/competition", "pick-clock", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Attach match/pit evidence to contested slots.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  return [
    {
      id: "board",
      label: filledSlots > 0 ? "Continue filling alliances" : "Assign first picks",
      detail:
        filledSlots > 0
          ? `${filledSlots} slot${filledSlots === 1 ? "" : "s"} filled — assign from scouted partners only.`
          : "Captains and picks stay blank until you assign real team numbers.",
      href: "#alliance-desk-board",
      primary: true,
    },
    {
      id: "picklist-collab",
      label: "Open Collaborative Pick List",
      detail: "Cross-check consensus ranks before locking.",
      href: hubHref("/competition", "picklist-collab", orgId),
    },
    {
      id: "pick-clock",
      label: "Open Pick clock",
      detail: "Run timed picks against your real list.",
      href: hubHref("/competition", "pick-clock", orgId),
    },
    {
      id: "export",
      label: "Export drive-team pack",
      detail: "Print pack from assigned slots only.",
      href: "#alliance-desk-export",
    },
  ];
}
