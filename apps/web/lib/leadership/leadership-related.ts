import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import { setupActionsFrom } from "../setup-actions";

/** Header strip for Leadership — Season roles · Skills · Safety. */
export const LEADERSHIP_RELATED_LINKS = [
  { id: "roles", label: "Season roles", tab: "roles" },
  { id: "skills-graph", label: "Skills", tab: "skills-graph" },
  { id: "safety-training", label: "Safety", tab: "safety-training" },
] as const;

export type LeadershipRelatedId = (typeof LEADERSHIP_RELATED_LINKS)[number]["id"];

export type LeadershipRelatedLink = {
  id: LeadershipRelatedId;
  label: string;
  href: string;
};

export const LEADERSHIP_RELATED_INCLUDE: LeadershipRelatedId[] = [
  "roles",
  "skills-graph",
  "safety-training",
];

/**
 * Cross-links from Leadership → Season roles / Skills / Safety.
 * Build with hubHref — never broken JSX href templates.
 */
export function leadershipRelatedLinks(
  orgId?: string | null,
  options?: { active?: LeadershipRelatedId; include?: LeadershipRelatedId[] },
): LeadershipRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return LEADERSHIP_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type LeadershipShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type LeadershipNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type LeadershipEmptyCopy = {
  kind: LeadershipShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type LeadershipSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

function leadershipRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    leadershipRelatedLinks(orgId, { include: [...LEADERSHIP_RELATED_INCLUDE] }).map(
      (link) => link.href,
    ),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = leadershipRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function leadershipSetupSteps(orgId?: string | null): LeadershipSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Leadership.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
  ];
}

/** Hide 0% succession tiles until a role exists. */
export function shouldShowLeadershipSummaryTiles(roleCount: number): boolean {
  return roleCount > 0;
}

export function classifyLeadershipShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  roleCount?: number;
}): LeadershipShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.roleCount ?? 0) === 0) return "empty";
  return "ready";
}

export function leadershipShellCopy(kind: LeadershipShellKind): LeadershipEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Leadership…",
        description: "Checking which team you are on and who holds each role.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Leadership",
        description: "A network or server issue blocked Leadership. Retry, or open Season roles while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description: "Choose your team before tracking who holds each role and who is next.",
      };
    case "empty":
      return {
        kind,
        badge: "No roles yet",
        title: "Add your first leadership role",
        description: "Officer positions, subsystem leads, mentors — track who holds each role and who is next.",
      };
    case "ready":
      return {
        kind,
        title: "Leadership Continuity",
        description: "Who holds each role and who is next.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

/**
 * Next actions for Leadership. Empty/setup keep one EmptyState primary;
 * Season roles / Skills / Safety stay in the header; the panel paints only on ready.
 */
export function leadershipNextActions(input: {
  orgId?: string | null;
  shell: LeadershipShellKind;
  roleCount?: number;
}): LeadershipNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(leadershipSetupSteps(orgId));
  }

  switch (input.shell) {
    case "loading":
    case "empty":
    case "error":
      return [];
    case "ready":
      return dropRelatedStripDuplicates(orgId, [
        {
          id: "handoff-board",
          label: "Review who is next",
          detail: "Name a successor on each role so the next season is not a scramble.",
          href: withOrgHref("/leadership", orgId),
          primary: true,
        },
      ]);
    default: {
      const _never: never = input.shell;
      return _never;
    }
  }
}
