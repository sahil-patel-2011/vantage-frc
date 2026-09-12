import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Soft-UI related surfaces for Pick desk (never DEMO picks). */
export const PICK_DESK_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "draft", label: "Draft board", kind: "path" as const, path: "/strategy/draft" },
  { id: "pick-clock", label: "Pick clock", kind: "path" as const, path: "/pick-clock" },
  { id: "team-data", label: "Team data", kind: "path" as const, path: "/team/data" },
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

function pickDeskRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    pickDeskRelatedLinks(orgId, { include: [...PICK_DESK_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = pickDeskRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function pickDeskSetupSteps(orgId?: string | null): PickDeskSetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open pick desks.",
        href: "/workspace",
      },
    ];
  }
  return dropRelatedStripDuplicates(orgId, [
    {
      id: "command",
      label: "Set active event",
      detail: "Pick the event this alliance is at — ranks stay blank until it is set.",
      href: hubHref("/competition", "command", orgId),
    },
  ]);
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
        description: "Checking which team you are on and who you can rank.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load pick desk",
        description:
          "A network or server issue blocked the desk. Retry, or open Strategy / Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and the event this alliance is at before you rank picks.",
      };
    case "empty":
      return {
        kind,
        badge: "No teams yet",
        title: "No teams to rank yet",
        description:
          "Scout a few matches, or wait until the event list is in. Ranks stay blank until then.",
      };
    case "ready":
      return {
        kind,
        title: "Rank, pick, and lock",
        description:
          "Move teams into first / second / third, then lock the list. Numbers come from your scouting and the event list.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
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
    return setupActionsFrom(pickDeskSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry pick desk",
        detail: "Reload the list of teams you can rank.",
        href: hubHref("/competition", "picks", orgId),
        primary: true,
      },
    ];
  }

  if (input.shell === "empty" || candidateCount === 0) {
    return [
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout a few matches so you have notes to rank from.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
    ];
  }

  return [
    {
      id: "lists",
      label: listCount > 0 ? "Lock this list" : "Rank teams, then lock",
      detail:
        listCount > 0
          ? `${formatPickDeskMetric(listCount, true)} saved list${listCount === 1 ? "" : "s"} from real event teams.`
          : "Move teams into first / second / third, then lock the list.",
      href: hubHref("/competition", "picks", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Add match notes so picks have a why.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}
