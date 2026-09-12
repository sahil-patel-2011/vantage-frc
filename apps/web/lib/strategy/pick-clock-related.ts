import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
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

function pickClockRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    pickClockRelatedLinks(orgId, { include: [...PICK_CLOCK_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = pickClockRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function pickClockSetupSteps(orgId?: string | null): PickClockSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open pick clock.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — recommendations stay blank until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ]);
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
        title: "Opening Pick clock",
        description:
          "Checking which team you are on and synced event numbers.",
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
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and the event this alliance is at before pick recommendations appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No teams left to recommend",
        title: "Waiting on a real pick pool",
        description:
          "Recommendations stay blank until this event has a team list and free draft slots. Cross-check Strategy, Pick desk, and Chemistry.",
      };
    case "ready":
      return {
        kind,
        title: "45-second pick clock",
        description:
          "Next best available team from this event’s numbers and this team’s scout notes."
      };
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
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
  const excludedCount = input.excludedCount ?? 0;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(pickClockSetupSteps(orgId));
  }

  switch (input.shell) {
    case "loading":
    case "ready":
      return [];
    case "error":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "retry",
          label: "Retry pick clock",
          detail: "Reload event ratings and draft exclusions.",
          href: hubHref("/competition", "pick-clock", orgId),
          primary: true,
        },
      ]);
    case "empty":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "team-data",
          label: "Sync Team Data",
          detail:
            excludedCount > 0
              ? `${formatPickClockMetric(excludedCount, true)} team${excludedCount === 1 ? "" : "s"} already taken on the draft board. Sync or clear slots.`
              : "Pull match and ranking rows from Team → Data. Recommendations stay blank until those rows exist.",
          href: withOrgHref("/team/data", orgId),
          primary: true,
        },
      ]);
    default: {
      const _exhaustive: never = input.shell;
      return _exhaustive;
    }
  }
}
