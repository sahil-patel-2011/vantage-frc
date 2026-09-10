import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Pick clock (never DEMO picks). */
export const PICK_CLOCK_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "pick-desk", label: "Pick desk", kind: "path" as const, path: "/strategy?tab=picks" },
  { id: "chemistry", label: "Chemistry", kind: "hub" as const, tab: "chemistry" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "draft", label: "Draft board", kind: "path" as const, path: "/strategy/draft" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
] as const;

export type PickClockRelatedId = (typeof PICK_CLOCK_RELATED_LINKS)[number]["id"];

export type PickClockRelatedLink = {
  id: PickClockRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy · Pick desk · Chemistry. */
export const PICK_CLOCK_RELATED_INCLUDE: PickClockRelatedId[] = [
  "strategy",
  "pick-desk",
  "chemistry",
];

/**
 * Soft-UI cross-links from Pick clock → Strategy / Pick desk / Chemistry.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function pickClockRelatedLinks(
  orgId?: string | null,
  options?: { active?: PickClockRelatedId; include?: PickClockRelatedId[] },
): PickClockRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return PICK_CLOCK_RELATED_LINKS.filter((link) => {
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

export type PickClockShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type PickClockNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type PickClockEmptyCopy = {
  kind: PickClockShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO picks. */
export type PickClockSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function pickClockSetupSteps(orgId?: string | null): PickClockSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open pick clock.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the TBA event your team is competing at — recommendations stay blank until synced.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull TBA/Statbotics rows into Neon.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Confirm event context before running the 45-second pick clock.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Arrange first / second / third picks from real event teams before the clock.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
    {
      id: "chemistry",
      label: "Open Chemistry",
      detail: "Score alliance fit from synced seats.",
      href: hubHref("/competition", "chemistry", orgId),
    },
  ];
}

/** Real available / scouted counts only — never invent DEMO totals. */
export function formatPickClockMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed KPI tiles when nothing is available — avoids DEMO picks. */
export function shouldShowPickClockSummaryTiles(availableCount: number): boolean {
  return availableCount > 0;
}

/** True when there is no recommendation left — Soft-UI empty until real pool exists. */
export function isPickClockQueueEmpty(input: {
  hasRecommendation: boolean;
  availableCount: number;
}): boolean {
  return !input.hasRecommendation || input.availableCount === 0;
}

/** Classify Pick clock Soft-UI shell — never invents DEMO picks. */
export function classifyPickClockShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  orgId?: string | null;
  eventKey?: string | null;
  hasRecommendation?: boolean;
  availableCount?: number;
}): PickClockShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId || !input.eventKey) return "setup";
  if (
    isPickClockQueueEmpty({
      hasRecommendation: input.hasRecommendation ?? false,
      availableCount: input.availableCount ?? 0,
    })
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO picks. */
export function pickClockShellCopy(kind: PickClockShellKind): PickClockEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading pick clock…",
        description:
          "Checking workspace membership and TBA/Statbotics event metrics.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load pick clock",
        description:
          "A network or server issue blocked the clock. Retry, or open Strategy / Pick desk / Chemistry while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace and event",
        description:
          "Pick clock is org- and event-scoped. Pick a workspace and active TBA event before recommendations appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No teams left to recommend",
        title: "Waiting on a real pick pool",
        description:
          "Recommendations stay blank until synced event metrics (and free draft slots) exist. Cross-check Strategy, Pick desk, and Chemistry.",
      };
    default:
      return {
        kind: "ready",
        title: "45-second pick clock",
        description:
          "Next best available team from synced event metrics and membership-bound scout depth.",
      };
  }
}

/**
 * Soft-UI next actions for Pick clock empty/setup shells.
 * Points at Strategy / Pick desk / Chemistry — never invents DEMO picks.
 */
export function pickClockNextActions(input: {
  orgId?: string | null;
  shell: PickClockShellKind;
  eventKey?: string | null;
  hasRecommendation?: boolean;
  availableCount?: number;
  excludedCount?: number;
}): PickClockNextAction[] {
  const orgId = input.orgId ?? null;
  const availableCount = input.availableCount ?? 0;
  const excludedCount = input.excludedCount ?? 0;

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
          id: "pick-desk",
          label: "Open Pick desk",
          detail: "Pick tiers stay blank until your team syncs event rows.",
          href: withOrgHref("/strategy?tab=picks", null),
        },
        {
          id: "chemistry",
          label: "Open Chemistry",
          detail: "Chemistry scores stay blank until synced seats exist.",
          href: hubHref("/competition", "chemistry", null),
        },
      ];
    }
    return [
      {
        id: "command",
        label: "Set active event",
        detail: "Pick clock needs a TBA event before recommendations appear.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Confirm event context before running the selection clock.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Arrange first / second / third picks from real event teams.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "chemistry",
        label: "Open Chemistry",
        detail: "Score alliance fit once seats exist.",
        href: hubHref("/competition", "chemistry", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry pick clock",
        detail: "Reload real event metrics and draft exclusions — nothing is invented while this fails.",
        href: hubHref("/competition", "pick-clock", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while the clock reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "pick-desk",
        label: "Open Pick desk",
        detail: "Pick lists stay available while the clock reloads.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "chemistry",
        label: "Open Chemistry",
        detail: "Chemistry stays available while the clock reloads.",
        href: hubHref("/competition", "chemistry", orgId),
      },
    ];
  }

  if (
    input.shell === "empty" ||
    isPickClockQueueEmpty({
      hasRecommendation: input.hasRecommendation ?? false,
      availableCount,
    })
  ) {
    return [
      {
        id: "team-data",
        label: "Sync event metrics",
        detail:
          excludedCount > 0
            ? `${formatPickClockMetric(excludedCount, true)} team${excludedCount === 1 ? "" : "s"} already taken on the draft board. Sync or clear slots.`
            : "Pull TBA/Statbotics team_event_metrics — recommendations stay blank until then.",
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
        detail: "Link a real pick list before the clock ranks — empty tiers stay empty.",
        href: withOrgHref("/strategy?tab=picks", orgId),
      },
      {
        id: "chemistry",
        label: "Open Chemistry",
        detail: "Score alliance fit from synced seats.",
        href: hubHref("/competition", "chemistry", orgId),
      },
    ];
  }

  return [
    {
      id: "clock",
      label: "Run the 45s clock",
      detail: `${formatPickClockMetric(availableCount, true)} available team${availableCount === 1 ? "" : "s"} from synced metrics only.`,
      href: hubHref("/competition", "pick-clock", orgId),
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Return to event strategy while the selection clock runs.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "pick-desk",
      label: "Open Pick desk",
      detail: "Cross-check first / second / third tiers against the live recommendation.",
      href: withOrgHref("/strategy?tab=picks", orgId),
    },
    {
      id: "chemistry",
      label: "Open Chemistry",
      detail: "Score how the next pick fits your alliance seats.",
      href: hubHref("/competition", "chemistry", orgId),
    },
  ];
}
