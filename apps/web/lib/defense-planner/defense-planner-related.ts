import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Defense Planner (never DEMO defense metrics). */
export const DEFENSE_PLANNER_RELATED_LINKS = [
  { id: "strategy", label: "Strategy", tab: "strategy" },
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "counter-book", label: "Counter-book", tab: "counter-book" },
  { id: "opponent-watchlist", label: "Opponent Watchlist", tab: "opponent-watchlist" },
] as const;

export type DefensePlannerRelatedId = (typeof DEFENSE_PLANNER_RELATED_LINKS)[number]["id"];

export type DefensePlannerRelatedLink = {
  id: DefensePlannerRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Strategy / Scouting / Counter-book. */
export const DEFENSE_PLANNER_RELATED_INCLUDE: DefensePlannerRelatedId[] = [
  "strategy",
  "scouting",
  "counter-book",
];

/**
 * Soft-UI cross-links from Defense Planner → Strategy / Scouting / Counter-book.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function defensePlannerRelatedLinks(
  orgId?: string | null,
  options?: { active?: DefensePlannerRelatedId; include?: DefensePlannerRelatedId[] },
): DefensePlannerRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return DEFENSE_PLANNER_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type DefensePlannerShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type DefensePlannerNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type DefensePlannerEmptyCopy = {
  kind: DefensePlannerShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO defense metrics. */
export type DefensePlannerSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function defensePlannerSetupSteps(orgId?: string | null): DefensePlannerSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Defense Planner is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Event strategy stays empty until real metrics exist — no sample rankings.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout rows stay blank until your team enters them — no sample scores.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "counter-book",
      label: "Open Counter-book",
      detail: "Opponent tendencies stay blank until scout samples exist — no sample averages.",
      href: hubHref("/competition", "counter-book", orgId),
    },
  ];
}

/** Real matchup counts only — never invent DEMO defense totals. */
export function formatDefensePlannerMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when nothing is logged — avoids DEMO counters. */
export function shouldShowDefensePlannerSummaryTiles(input: {
  matchupCount: number;
  hasProfile: boolean;
}): boolean {
  return input.matchupCount > 0 || input.hasProfile;
}

/** True when the workspace has no matchups yet — Soft-UI empty. */
export function isDefensePlannerBoardEmpty(input: { matchupCount: number }): boolean {
  return input.matchupCount === 0;
}

/** Classify Defense Planner Soft-UI shell — never invents DEMO defense metrics. */
export function classifyDefensePlannerShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  matchupCount?: number;
}): DefensePlannerShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isDefensePlannerBoardEmpty({ matchupCount: input.matchupCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO defense metrics. */
export function defensePlannerShellCopy(kind: DefensePlannerShellKind): DefensePlannerEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Defense Planner…",
        description:
          "Checking workspace membership and logged matchups — never DEMO defense recommendations.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Defense Planner",
        description:
          "A network or server issue blocked matchups. Retry, or open Strategy / Scouting while it reloads — never invent DEMO defense metrics.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Defense Planner is org-scoped. Pick a workspace before logging robot profile or matchups — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No matchups yet",
        title: "Log your first opponent matchup",
        description:
          "Save our robot profile, then enter scouted mass, drivetrain, and cycle path. Recommendations use only what you log — never DEMO defense metrics.",
      };
    default:
      return {
        kind: "ready",
        title: "Defense matchups from your scouting",
        description:
          "Recommendations use only logged robot profile and scouted opponent cycles — never DEMO metrics.",
      };
  }
}

/**
 * Soft-UI next actions for Defense Planner empty/setup shells.
 * Points at Strategy / Scouting / Counter-book — never invents DEMO defense metrics.
 */
export function defensePlannerNextActions(input: {
  orgId?: string | null;
  shell: DefensePlannerShellKind;
  matchupCount?: number;
  hasProfile?: boolean;
}): DefensePlannerNextAction[] {
  const orgId = input.orgId ?? null;
  const matchupCount = input.matchupCount ?? 0;
  const hasProfile = input.hasProfile ?? false;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of defensePlannerSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(defensePlannerSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Defense Planner",
        detail: "Reload real matchups — nothing is invented while this fails.",
        href: withOrgHref("/defense-planner", orgId),
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while matchups reload.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while matchups reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || matchupCount === 0) {
    return [
      {
        id: "log",
        label: hasProfile ? "Log an opponent matchup" : "Save robot profile first",
        detail: hasProfile
          ? "Enter scouted mass, drivetrain, and cycle path below — never DEMO recommendations."
          : "Set our mass and drivetrain so containment math has real inputs.",
        href: hasProfile ? "#defense-planner-matchup" : "#defense-planner-profile",
        primary: true,
      },
      {
        id: "scouting",
        label: "Log scouting first",
        detail: "Cycle paths need real match scout rows — never DEMO averages.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "strategy",
        label: "Cross-check Strategy",
        detail: "Ground picks in scouted and reference metrics — never DEMO rankings.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "counter-book",
        label: "Open Counter-book",
        detail: "Pair tendency reports with defense recommendations.",
        href: hubHref("/competition", "counter-book", orgId),
      },
    ];
  }

  return [
    {
      id: "another",
      label: "Log another matchup",
      detail: `${matchupCount} matchup${matchupCount === 1 ? "" : "s"} on file — add more from scouted cycles only.`,
      href: "#defense-planner-matchup",
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Ground picks in scouted data and reference metrics — never DEMO rankings.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Add more match rows to strengthen cycle samples.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "counter-book",
      label: "Open Counter-book",
      detail: "Pair qualitative notes with quantitative defense plans.",
      href: hubHref("/competition", "counter-book", orgId),
    },
  ];
}
