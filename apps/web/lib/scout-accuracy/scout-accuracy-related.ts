import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout Accuracy (never DEMO scores). */
export const SCOUT_ACCURACY_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "coverage", label: "Coverage", kind: "path" as const, path: "/scouting/lineup" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "coverage-live", label: "Scout Coverage Live", kind: "path" as const, path: "/scout-coverage-live" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
] as const;

export type ScoutAccuracyRelatedId = (typeof SCOUT_ACCURACY_RELATED_LINKS)[number]["id"];

export type ScoutAccuracyRelatedLink = {
  id: ScoutAccuracyRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Coverage · Strategy. */
export const SCOUT_ACCURACY_RELATED_INCLUDE: ScoutAccuracyRelatedId[] = [
  "scouting",
  "coverage",
  "strategy",
];

/**
 * Soft-UI cross-links from Scout Accuracy → Scouting / Coverage / Strategy.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function scoutAccuracyRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutAccuracyRelatedId; include?: ScoutAccuracyRelatedId[] },
): ScoutAccuracyRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUT_ACCURACY_RELATED_LINKS.filter((link) => {
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

export type ScoutAccuracyShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutAccuracyNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutAccuracyEmptyCopy = {
  kind: ScoutAccuracyShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO scores. */
export type ScoutAccuracySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutAccuracySetupSteps(orgId?: string | null): ScoutAccuracySetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — accuracy is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Log real match-scout entries — leaderboard stays blank until then, never DEMO scores.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Confirm lineup gaps so every robot has a real scout row to score.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Pick-desk rotation reads the same accuracy ranks — never invents DEMO scores.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "command",
      label: "Set active event",
      detail: "TBA results must be cached for the event before totals can be verified.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}

/** Real counts only — never invent DEMO totals. */
export function formatScoutAccuracyMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/**
 * Accuracy score 0..100 from real verifiable entries only — blank until loaded; never DEMO scores.
 * Null / no verifiable data renders as an em dash, not 0.
 */
export function formatScoutAccuracyScore(
  value: unknown,
  loaded: boolean,
  options?: { hasVerifiable?: boolean },
): string {
  if (!loaded) return "…";
  if (options?.hasVerifiable === false) return "—";
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return String(Math.round(Math.min(100, n)));
}

/**
 * Accuracy rate 0..1 from real checks — blank until loaded; never DEMO %.
 * Null rates render as an em dash, not 0%.
 */
export function formatScoutAccuracyRate(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed KPI tiles when nothing is scored — avoids DEMO scores. */
export function shouldShowScoutAccuracySummaryTiles(input: {
  totalEntries: number;
  totalScouts: number;
}): boolean {
  return input.totalEntries > 0 || input.totalScouts > 0;
}

/** True when there is no event / no scout rows to score — Soft-UI empty. */
export function isScoutAccuracyLeaderboardEmpty(input: {
  eventKey?: string | null;
  totalEntries: number;
}): boolean {
  return !input.eventKey || input.totalEntries === 0;
}

/** Classify Scout Accuracy Soft-UI shell — never invents DEMO scores. */
export function classifyScoutAccuracyShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  eventKey?: string | null;
  totalEntries?: number;
}): ScoutAccuracyShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (
    isScoutAccuracyLeaderboardEmpty({
      eventKey: input.eventKey,
      totalEntries: input.totalEntries ?? 0,
    })
  ) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO scores. */
export function scoutAccuracyShellCopy(kind: ScoutAccuracyShellKind): ScoutAccuracyEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading scout accuracy…",
        description:
          "Checking workspace membership and TBA-verified scout rows — never DEMO scores.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load scout accuracy",
        description:
          "A network or server issue blocked the leaderboard. Retry, or open Scouting / Coverage / Strategy while it reloads — never invent DEMO scores.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Scout accuracy is org-scoped. Pick a workspace before TBA-verified ranks appear — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No scores yet",
        title: "Waiting on verifiable scout rows",
        description:
          "The leaderboard stays blank until your team logs match-scout entries for an event with cached TBA results. Cross-check Scouting, Coverage, and Strategy — never DEMO scores.",
      };
    default:
      return {
        kind: "ready",
        title: "Accuracy leaderboard",
        description:
          "Ranks use only real scout totals vs cached TBA score breakdowns — never DEMO scores.",
      };
  }
}

/**
 * Soft-UI next actions for Scout Accuracy empty/setup shells.
 * Points at Scouting / Coverage / Strategy — never invents DEMO scores.
 */
export function scoutAccuracyNextActions(input: {
  orgId?: string | null;
  shell: ScoutAccuracyShellKind;
  totalEntries?: number;
  suggestedPromotions?: number;
}): ScoutAccuracyNextAction[] {
  const orgId = input.orgId ?? null;
  const suggestedPromotions = input.suggestedPromotions ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Accuracy is org-scoped — pick a team before ranking scouts.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout rows stay blank until your team enters them — never DEMO scores.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "coverage",
          label: "Open Coverage",
          detail: "Lineup gaps stay honest until real assignments exist.",
          href: withOrgHref("/scouting/lineup", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist — never DEMO rankings.",
          href: hubHref("/competition", "strategy", null),
        },
      ];
    }
    return [
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Log match-scout entries so TBA can verify totals — never DEMO scores.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Fill lineup gaps so every robot has a real scout row.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Pick-desk rotation waits on the same real ranks.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "command",
        label: "Set active event",
        detail: "Confirm the TBA event so official score breakdowns can cache.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry scout accuracy",
        detail: "Reload real TBA-verified ranks — nothing is pre-seeded while this fails.",
        href: withOrgHref("/scout-accuracy", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the leaderboard reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Lineup coverage stays available while accuracy reloads.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Event strategy stays available while accuracy reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "empty" || (input.totalEntries ?? 0) === 0) {
    return [
      {
        id: "scouting",
        label: "Log scout entries",
        detail: "Accuracy stays blank until membership-bound match rows exist — never DEMO scores.",
        href: hubHref("/competition", "scouting", orgId),
        primary: true,
      },
      {
        id: "coverage",
        label: "Open Coverage",
        detail: "Cover open lineup gaps so every robot can be scored.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Pick desk waits on the same real scout data — never DEMO scores.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "command",
        label: "Sync event results",
        detail: "TBA score breakdowns must be cached before totals verify.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  return [
    {
      id: "rotation",
      label:
        suggestedPromotions > 0
          ? `Review ${suggestedPromotions} promotion${suggestedPromotions === 1 ? "" : "s"}`
          : "Review pick-desk rotation",
      detail:
        suggestedPromotions > 0
          ? "Confirm TBA-accurate scouts into the pick-desk conversation."
          : "Ranks use only verifiable totals — never DEMO scores.",
      href: suggestedPromotions > 0 ? "#accuracy-leaderboard" : hubHref("/competition", "strategy", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Keep logging membership-bound match rows for fresher ranks.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage",
      detail: "Cross-check lineup gaps against who is being scored here.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Seat accurate scouts at the pick desk from these ranks.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ];
}
