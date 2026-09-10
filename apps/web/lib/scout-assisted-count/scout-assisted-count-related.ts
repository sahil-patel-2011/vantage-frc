import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout-Assisted Count (never DEMO tap tallies). */
export const SCOUT_ASSISTED_COUNT_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", tab: "scouting" },
  { id: "forms", label: "Form builder", tab: "forms" },
  { id: "scout-field-budget", label: "Field Budget", tab: "scout-field-budget" },
  { id: "scout-coverage-live", label: "Coverage Live", tab: "scout-coverage-live" },
] as const;

export type ScoutAssistedCountRelatedId = (typeof SCOUT_ASSISTED_COUNT_RELATED_LINKS)[number]["id"];

export type ScoutAssistedCountRelatedLink = {
  id: ScoutAssistedCountRelatedId;
  label: string;
  href: string;
};

export const SCOUT_ASSISTED_COUNT_RELATED_INCLUDE: ScoutAssistedCountRelatedId[] = [
  "scouting",
  "forms",
  "scout-coverage-live",
];

export function scoutAssistedCountRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutAssistedCountRelatedId; include?: ScoutAssistedCountRelatedId[] },
): ScoutAssistedCountRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUT_ASSISTED_COUNT_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type ScoutAssistedCountShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutAssistedCountNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutAssistedCountEmptyCopy = {
  kind: ScoutAssistedCountShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ScoutAssistedCountSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutAssistedCountSetupSteps(orgId?: string | null): ScoutAssistedCountSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization to open tap sessions.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Match and team keys from real scout entries pair with count sessions.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "forms",
      label: "Open Form builder",
      detail: "Numeric fields can be filled from audited tap tallies.",
      href: hubHref("/competition", "forms", orgId),
    },
  ];
}

export function formatScoutAssistedCountMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

export function shouldShowScoutAssistedCountSummaryTiles(sessionCount: number, tapCount: number): boolean {
  return sessionCount > 0 || tapCount > 0;
}

export function classifyScoutAssistedCountShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  sessionCount?: number;
}): ScoutAssistedCountShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.sessionCount ?? 0) === 0) return "empty";
  return "ready";
}

export function scoutAssistedCountShellCopy(kind: ScoutAssistedCountShellKind): ScoutAssistedCountEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Scout-Assisted Count…",
        description: "Checking workspace membership and tap sessions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Scout-Assisted Count",
        description:
          "A network or server issue blocked tap sessions. Retry, or open Scouting while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Pick a workspace before starting sessions.",
      };
    case "empty":
      return {
        kind,
        badge: "No sessions yet",
        title: "Start your first counting session",
        description: "Tap during a match — every tap is retained for audit.",
      };
    default:
      return {
        kind: "ready",
        title: "Assisted count sessions",
        description: "Tallies from real taps only.",
      };
  }
}

export function scoutAssistedCountNextActions(input: {
  orgId?: string | null;
  shell: ScoutAssistedCountShellKind;
  sessionCount?: number;
  openSessions?: number;
}): ScoutAssistedCountNextAction[] {
  const orgId = input.orgId ?? null;
  const sessionCount = input.sessionCount ?? 0;
  const openSessions = input.openSessions ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Pick a team before counting.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Match keys stay blank until your team scouts.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Scout-Assisted Count can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Use real match keys when starting sessions.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Scout-Assisted Count",
        detail: "Reload real tap sessions — nothing is invented while this fails.",
        href: withOrgHref("/scout-assisted-count", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scouting stays available while sessions reload.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || sessionCount === 0) {
    return [
      {
        id: "start-session",
        label: "Start a counting session",
        detail: "Sessions stay blank until you start one.",
        href: "#scout-assisted-count-start",
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Copy match keys from real scout entries.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Numeric fields can receive audited tallies.",
        href: hubHref("/competition", "forms", orgId),
      },
    ];
  }

  return [
    {
      id: openSessions > 0 ? "tap-open" : "review-sessions",
      label: openSessions > 0 ? "Tap open sessions" : "Review closed sessions",
      detail:
        openSessions > 0
          ? `${openSessions} open session${openSessions === 1 ? "" : "s"} with real taps.`
          : `${sessionCount} session${sessionCount === 1 ? "" : "s"} from audited taps.`,
      href: "#scout-assisted-count-sessions",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Cross-check tallies against scout entries.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage Live",
      detail: "See which matches still need counts.",
      href: hubHref("/competition", "scout-coverage-live", orgId),
    },
  ];
}
