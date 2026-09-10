import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Pick desk (never DEMO picks). */
export const PICK_DESK_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "draft", label: "Draft board", kind: "path" as const, path: "/strategy/draft" },
  { id: "pick-clock", label: "Pick clock", kind: "path" as const, path: "/pick-clock" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
] as const;

export type PickDeskRelatedId = (typeof PICK_DESK_RELATED_LINKS)[number]["id"];

export type PickDeskRelatedLink = {
  id: PickDeskRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy · Scouting · Coverage. */
export const PICK_DESK_RELATED_INCLUDE: PickDeskRelatedId[] = [
  "strategy",
  "scouting",
  "coverage",
];

/**
 * Soft-UI cross-links from Pick desk → Strategy / Scouting / Coverage.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function pickDeskRelatedLinks(
  orgId?: string | null,
  options?: { active?: PickDeskRelatedId; include?: PickDeskRelatedId[] },
): PickDeskRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PICK_DESK_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "hub") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type PickDeskShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PickDeskNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type PickDeskEmptyCopy = {
  kind: PickDeskShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO picks. */
export type PickDeskSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function pickDeskSetupSteps(orgId?: string | null): PickDeskSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open pick desks.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the TBA event your team is competing at — ranks stay blank until synced.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull rankings from The Blue Alliance and Statbotics.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Match and pit entries deepen pick explainability once synced.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Confirm which matches still need scouts before trusting pick ranks.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
  ];
}

/** Real candidate / list counts only — never invent DEMO totals. */
export function formatPickDeskMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed KPI tiles when the pool has no real teams — avoids DEMO picks. */
export function shouldShowPickDeskSummaryTiles(candidateCount: number): boolean {
  return candidateCount > 0;
}

/** True when the event pool has no synced metrics — Soft-UI empty until rows exist. */
export function isPickDeskPoolEmpty(input: { candidateCount: number }): boolean {
  return input.candidateCount === 0;
}

/** Classify Pick desk Soft-UI shell — never invents DEMO picks. */
export function classifyPickDeskShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  eventKey?: string | null;
  candidateCount?: number;
}): PickDeskShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId || !input.eventKey) return "setup";
  if (isPickDeskPoolEmpty({ candidateCount: input.candidateCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO picks. */
export function pickDeskShellCopy(kind: PickDeskShellKind): PickDeskEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading pick desk…",
        description:
          "Checking workspace membership and TBA/Statbotics event metrics.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load pick desk",
        description:
          "A network or server issue blocked the desk. Retry, or open Strategy / Scouting / Coverage while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace and event",
        description:
          "Pick desk is org- and event-scoped. Pick a workspace and active TBA event before ranks appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No event metrics yet",
        title: "Waiting on synced team metrics",
        description:
          "First / second / third pick tiers stay blank until TBA/Statbotics rows land for this event. Cross-check Strategy, Scouting, and Coverage.",
      };
    default:
      return {
        kind: "ready",
        title: "First / second / third pick desk",
        description:
          "Ranks use only synced event metrics and membership-bound scout depth.",
      };
  }
}

/**
 * Soft-UI next actions for Pick desk empty/setup shells.
 * Points at Strategy / Scouting / Coverage — never invents DEMO picks.
 */
export function pickDeskNextActions(input: {
  orgId?: string | null;
  shell: PickDeskShellKind;
  eventKey?: string | null;
  candidateCount?: number;
  listCount?: number;
}): PickDeskNextAction[] {
  const orgId = input.orgId ?? null;
  const candidateCount = input.candidateCount ?? 0;
  const listCount = input.listCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Choose a team before ranking alliances.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Win/loss and pick lists stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout rows stay blank until your team enters them.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "coverage",
          label: "Open Coverage",
          detail: "Coverage stays blank until a schedule syncs.",
          href: withOrgHref("/scouting/lineup", null),
        },
      ];
    }
    return [
      {
        id: "command",
        label: "Set active event",
        detail: "Pick desk needs a TBA event before the candidate pool appears.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before arranging first / second / third picks.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout depth stays honest when the event is unset.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "See which matches still need scouts for this event.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry pick desk",
        detail: "Reload real event metrics and saved lists.",
        href: hubHref("/competition", "strategy", orgId),
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
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Coverage stays available while the desk reloads.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  if (input.shell === "empty" || candidateCount === 0) {
    return [
      {
        id: "team-data",
        label: "Sync event metrics",
        detail: "Pull TBA/Statbotics team_event_metrics — pick tiers stay blank until then.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Win/loss waits on the same reference rows.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Add match notes so explainability lands once metrics sync.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Confirm scout depth before trusting first-pick ranks.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
    ];
  }

  return [
    {
      id: "lists",
      label: listCount > 0 ? "Review saved pick lists" : "Arrange tiers, then save",
      detail:
        listCount > 0
          ? `${formatPickDeskMetric(listCount, true)} saved list${listCount === 1 ? "" : "s"} use real event teams only.`
          : "Drop teams from the synced pool into first / second / third — empty tiers stay empty.",
      href: hubHref("/competition", "strategy", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Deepen pick explainability with membership-bound scout rows.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Cross-check which matches still need scouts before alliance selection.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "draft",
      label: "Open Draft board",
      detail: "Run draft day on the same real event pool.",
      href: withOrgHref("/strategy/draft", orgId),
    },
  ];
}
