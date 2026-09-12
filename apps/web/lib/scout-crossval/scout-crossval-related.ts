import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout Cross-Validation (never DEMO agreement %). */
export const SCOUT_CROSSVAL_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "coverage-live", label: "Coverage", kind: "path" as const, path: "/scout-coverage-live" },
  { id: "accuracy", label: "Accuracy", kind: "path" as const, path: "/scout-accuracy" },
  { id: "disagreements", label: "Disagreements", kind: "path" as const, path: "/scout-disagreements" },
  { id: "command", label: "Event day", kind: "hub" as const, tab: "command" },
] as const;

export type ScoutCrossvalRelatedId = (typeof SCOUT_CROSSVAL_RELATED_LINKS)[number]["id"];

export type ScoutCrossvalRelatedLink = {
  id: ScoutCrossvalRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Coverage · Accuracy. */
export const SCOUT_CROSSVAL_RELATED_INCLUDE: ScoutCrossvalRelatedId[] = [
  "scouting",
  "coverage-live",
  "accuracy",
];

export function scoutCrossvalRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutCrossvalRelatedId; include?: ScoutCrossvalRelatedId[] },
): ScoutCrossvalRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUT_CROSSVAL_RELATED_LINKS.filter((link) => {
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

export type ScoutCrossvalShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutCrossvalNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutCrossvalEmptyCopy = {
  kind: ScoutCrossvalShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ScoutCrossvalSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutCrossvalSetupSteps(orgId?: string | null): ScoutCrossvalSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open official cross-checks.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Log real match-scout entries — checks stay blank until then.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "command",
      label: "Sync event results",
      detail: "Official score breakdowns must be synced before fields can agree or conflict.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "coverage-live",
      label: "Open Coverage",
      detail: "Cover zero/thin robots so more entries can be cross-validated.",
      href: withOrgHref("/scout-coverage-live", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "Post-event ranks use the same official totals.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
  ];
}

/** Real counts only — never invent DEMO totals. */
export function formatScoutCrossvalMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/**
 * Agreement rate 0..1 from verifiable entries only — blank until loaded; never DEMO %.
 * Null / no verifiable data renders as an em dash, not 0%.
 */
export function formatScoutCrossvalRate(
  value: unknown,
  loaded: boolean,
  options?: { hasVerifiable?: boolean },
): string {
  if (!loaded) return "…";
  if (options?.hasVerifiable === false) return "—";
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed KPI tiles when nothing is logged — avoids DEMO agreement. */
export function shouldShowScoutCrossvalSummaryTiles(input: {
  totalEntries: number;
}): boolean {
  return input.totalEntries > 0;
}

/** True when there are no match-scout entries to check — Soft-UI empty. */
export function isScoutCrossvalEmpty(input: { totalEntries: number }): boolean {
  return input.totalEntries === 0;
}

/** Classify Scout Cross-Validation Soft-UI shell — never invents DEMO agreement. */
export function classifyScoutCrossvalShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  totalEntries?: number;
}): ScoutCrossvalShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isScoutCrossvalEmpty({ totalEntries: input.totalEntries ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO agreement. */
export function scoutCrossvalShellCopy(kind: ScoutCrossvalShellKind): ScoutCrossvalEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading scout cross-validation…",
        description:
          "Checking which team you are on and cached official score breakdowns.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load scout cross-validation",
        description:
          "A network or server issue blocked official field checks. Retry, or open Scouting / Coverage / Accuracy while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before agree/conflict badges appear.",
      };
    case "empty":
      return {
        kind,
        badge: "No entries yet",
        title: "Waiting on match-scout rows",
        description:
          "Field checks stay blank until your team logs match entries for an event with cached official results. Cross-check Scouting, Coverage, and Accuracy.",
      };
    default:
      return {
        kind: "ready",
        title: "Official field checks",
        description:
          "Agree / conflict / unverifiable badges use only cached official score breakdowns.",
      };
  }
}

/**
 * Soft-UI next actions for Scout Cross-Validation empty/setup shells.
 * Points at Scouting / Coverage / Accuracy — never invents DEMO agreement.
 */
export function scoutCrossvalNextActions(input: {
  orgId?: string | null;
  shell: ScoutCrossvalShellKind;
  conflictEntries?: number;
  totalEntries?: number;
}): ScoutCrossvalNextAction[] {
  const orgId = input.orgId ?? null;
  const conflictEntries = input.conflictEntries ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before official checks run.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Field checks stay blank until your team enters rows.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "coverage-live",
          label: "Open Coverage",
          detail: "Gaps stay honest until real scout rows exist.",
          href: withOrgHref("/scout-coverage-live", null),
        },
        {
          id: "accuracy",
          label: "Open Accuracy",
          detail: "Ranks stay blank until official totals exist.",
          href: withOrgHref("/scout-accuracy", null),
        },
      ];
    }
    return [
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Log match-scout entries so official results can compare totals.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Sync event results",
        detail: "Confirm the event so official score breakdowns can cache.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "coverage-live",
        label: "Open Coverage",
        detail: "Close zero/thin cells so more entries can be checked.",
        href: withOrgHref("/scout-coverage-live", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Post-event ranks wait on the same real official checks.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry cross-validation",
        detail: "Reload real official field checks.",
        href: withOrgHref("/scout-crossval", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while official checks reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage-live",
        label: "Open Coverage",
        detail: "Coverage gaps stay available while cross-validation reloads.",
        href: withOrgHref("/scout-coverage-live", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Accuracy ranks stay available while official checks reload.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "scouting",
        label: "Log scout entries",
        detail: "Cross-validation stays blank until this team's match entries exist.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "coverage-live",
        label: "Open Coverage",
        detail: "Cover open robots so entries can land for official checks.",
        href: withOrgHref("/scout-coverage-live", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Leaderboard waits on the same real official totals.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "command",
        label: "Sync event results",
        detail: "Official score breakdowns must be synced before fields verify.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  return [
    {
      id: "conflicts",
      label:
        conflictEntries > 0
          ? `Review ${conflictEntries} conflict${conflictEntries === 1 ? "" : "s"}`
          : "Review official field checks",
      detail:
        conflictEntries > 0
          ? "Re-check entries that disagree with cached official score breakdowns."
          : "Agreement uses only verifiable official fields.",
      href: conflictEntries > 0 ? "#crossval-entries" : hubHref("/competition", "scouting", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Keep logging this team's match entries for fresher checks.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage-live",
      label: "Open Coverage",
      detail: "Cross-check which robots still need scout rows.",
      href: withOrgHref("/scout-coverage-live", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "Roll the same official checks into pick-desk rotation ranks.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
  ];
}
