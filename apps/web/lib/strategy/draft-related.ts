import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Draft board (never DEMO boards). */
export const DRAFT_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "pick-clock", label: "Pick clock", kind: "path" as const, path: "/pick-clock" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
] as const;

export type DraftRelatedId = (typeof DRAFT_RELATED_LINKS)[number]["id"];

export type DraftRelatedLink = {
  id: DraftRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy · Pick desk · Scouting. */
export const DRAFT_RELATED_INCLUDE: DraftRelatedId[] = ["strategy", "pick-desk", "scouting"];

/**
 * Soft-UI cross-links from Draft board → Strategy / Pick desk / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function draftRelatedLinks(
  orgId?: string | null,
  options?: { active?: DraftRelatedId; include?: DraftRelatedId[] },
): DraftRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DRAFT_RELATED_LINKS.filter((link) => {
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

export type DraftShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type DraftNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DraftEmptyCopy = {
  kind: DraftShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO boards. */
export type DraftSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function draftSetupSteps(orgId?: string | null): DraftSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — draft boards are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the TBA event your team is competing at — alliance slots stay blank until synced.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull TBA/Statbotics rows into Neon.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Arrange first / second / third picks from real event teams before draft day.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Match and pit entries deepen pick assist once synced.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

/** Real pool / filled-slot counts only — never invent DEMO totals. */
export function formatDraftMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed KPI tiles when the event has no real teams — avoids DEMO boards. */
export function shouldShowDraftSummaryTiles(teamCount: number): boolean {
  return teamCount > 0;
}

/** True when there is no board or no synced event pool — Soft-UI empty until rows exist. */
export function isDraftBoardEmpty(input: { hasBoard: boolean; teamCount: number }): boolean {
  return !input.hasBoard || input.teamCount === 0;
}

/**
 * Share tokens stay bound to the issuing org + board.
 * Mentor links never invent DEMO boards or cross-org snapshots.
 */
export function isDraftShareTokenOrgIsolated(input: {
  orgId?: string | null;
  boardId?: string | null;
}): boolean {
  return Boolean(input.orgId && input.boardId);
}

/** Classify Draft board Soft-UI shell — never invents DEMO boards. */
export function classifyDraftShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  eventKey?: string | null;
  hasBoard?: boolean;
  teamCount?: number;
}): DraftShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId || !input.eventKey) return "setup";
  if (isDraftBoardEmpty({ hasBoard: input.hasBoard ?? false, teamCount: input.teamCount ?? 0 })) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO boards. */
export function draftShellCopy(kind: DraftShellKind): DraftEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading draft board…",
        description:
          "Checking workspace membership and event alliance board.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load draft board",
        description:
          "A network or server issue blocked the board. Retry, or open Strategy / Pick desk / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace and event",
        description:
          "Draft day is org- and event-scoped. Pick a workspace and active TBA event before alliance slots appear — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No draft board yet",
        title: "Waiting on a real event board",
        description:
          "Alliance slots stay blank until an owner/admin opens Draft day with synced event metrics. Cross-check Strategy, Pick desk, and Scouting.",
      };
    default:
      return {
        kind: "ready",
        title: "Draft day alliance board",
        description:
          "Captains, first picks, then reverse second picks from synced event teams only. Mentor share links stay org-bound.",
      };
  }
}

/**
 * Soft-UI next actions for Draft board empty/setup shells.
 * Points at Strategy / Pick desk / Scouting — never invents DEMO boards.
 */
export function draftNextActions(input: {
  orgId?: string | null;
  shell: DraftShellKind;
  eventKey?: string | null;
  hasBoard?: boolean;
  teamCount?: number;
  filledSlots?: number;
}): DraftNextAction[] {
  const orgId = input.orgId ?? null;
  const teamCount = input.teamCount ?? 0;
  const filledSlots = input.filledSlots ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Draft boards are org-scoped — choose a team before alliance selection.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Win/loss and draft day stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Pick tiers stay blank until your team syncs event rows.",
          href: withOrgHref("/strategy?tab=picks", null),
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
        id: "command",
        label: "Set active event",
        detail: "Draft day needs a TBA event before the alliance board appears.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before opening draft day.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Arrange first / second / third picks before captains start selecting.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout depth stays honest when the event is unset.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry draft board",
        detail: "Reload the real org-scoped alliance board — nothing is invented while this fails.",
        href: withOrgHref("/strategy/draft", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the board reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Pick lists stay available while the board reloads.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the board reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || !input.hasBoard || teamCount === 0) {
    return [
      {
        id: "team-data",
        label: "Sync event metrics",
        detail:
          "Pull TBA/Statbotics team_event_metrics — the draft pool stays blank until then.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Win/loss waits on the same Neon reference rows.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Link a real pick list before draft day — empty tiers stay empty.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Add match notes so pick assist lands once metrics sync.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  return [
    {
      id: "board",
      label: filledSlots > 0 ? "Continue draft day" : "Start captains, then first picks",
      detail:
        filledSlots > 0
          ? `${formatDraftMetric(filledSlots, true)} filled slot${filledSlots === 1 ? "" : "s"} use real event teams only. Mentor links stay org-bound.`
          : "Assign captains, then first picks, then reverse second picks from the synced pool.",
      href: withOrgHref("/strategy/draft", orgId),
      primary: true,
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Cross-check first / second / third tiers against the live board.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Deepen pick assist with membership-bound scout rows.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Return to event strategy while draft day runs.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ];
}
