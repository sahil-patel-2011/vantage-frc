import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout Data Impact (never DEMO pick credit). */
export const SCOUT_DATA_IMPACT_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "accuracy", label: "Accuracy", kind: "path" as const, path: "/scout-accuracy" },
  { id: "coverage-live", label: "Coverage Live", kind: "path" as const, path: "/scout-coverage-live" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
] as const;

export type ScoutDataImpactRelatedId = (typeof SCOUT_DATA_IMPACT_RELATED_LINKS)[number]["id"];

export type ScoutDataImpactRelatedLink = {
  id: ScoutDataImpactRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Strategy · Accuracy. */
export const SCOUT_DATA_IMPACT_RELATED_INCLUDE: ScoutDataImpactRelatedId[] = [
  "scouting",
  "strategy",
  "accuracy",
];

export function scoutDataImpactRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutDataImpactRelatedId; include?: ScoutDataImpactRelatedId[] },
): ScoutDataImpactRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUT_DATA_IMPACT_RELATED_LINKS.filter((link) => {
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

export type ScoutDataImpactShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutDataImpactNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutDataImpactEmptyCopy = {
  kind: ScoutDataImpactShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ScoutDataImpactSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutDataImpactSetupSteps(orgId?: string | null): ScoutDataImpactSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open where-your-data-went.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Log real match-scout rows for teams that may be picked.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Save pick lists at the desk so logged picks can credit real scout entries.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "TBA-verified ranks help explain why a scout's data earned a seat.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pin the event so picks and scout rows stay on the same competition.",
      href: hubHref("/competition", "command", orgId),
    },
  ];
}

/** Real counts only — never invent DEMO totals. */
export function formatScoutDataImpactMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/**
 * Pick coverage 0..1 from real logged picks — blank until loaded; never DEMO %.
 * Null / no picks renders as an em dash, not 0%.
 */
export function formatScoutDataImpactRate(
  value: unknown,
  loaded: boolean,
  options?: { hasPicks?: boolean },
): string {
  if (!loaded) return "…";
  if (options?.hasPicks === false) return "—";
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed KPI tiles when nothing is logged — avoids DEMO pick credit. */
export function shouldShowScoutDataImpactSummaryTiles(input: {
  pickCount: number;
  totalEntries: number;
}): boolean {
  return input.pickCount > 0 || input.totalEntries > 0;
}

/** True when no alliance picks are logged — Soft-UI empty. */
export function isScoutDataImpactEmpty(input: { pickCount: number }): boolean {
  return input.pickCount === 0;
}

/** Classify Scout Data Impact Soft-UI shell — never invents DEMO pick credit. */
export function classifyScoutDataImpactShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  pickCount?: number;
}): ScoutDataImpactShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isScoutDataImpactEmpty({ pickCount: input.pickCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO pick credit. */
export function scoutDataImpactShellCopy(kind: ScoutDataImpactShellKind): ScoutDataImpactEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading scout data impact…",
        description:
          "Checking which team you are on and logged alliance picks.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load scout data impact",
        description:
          "A network or server issue blocked the feedback loop. Retry, or open Scouting / Strategy / Accuracy while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Choose your team",
        description:
          "Choose your team before pick credit appears.",
      };
    case "empty":
      return {
        kind,
        badge: "No picks yet",
        title: "Waiting on logged alliance picks",
        description:
          "Credit stays blank until coaches log real picks and matching scout rows exist. Cross-check Scouting, Strategy, and Accuracy.",
      };
    default:
      return {
        kind: "ready",
        title: "Where your data went",
        description:
          "Each pick credits only real match-scout entries for that team.",
      };
  }
}

/**
 * Soft-UI next actions for Scout Data Impact empty/setup shells.
 * Points at Scouting / Strategy / Accuracy — never invents DEMO credit.
 */
export function scoutDataImpactNextActions(input: {
  orgId?: string | null;
  shell: ScoutDataImpactShellKind;
  pickCount?: number;
  uncoveredPicks?: number;
}): ScoutDataImpactNextAction[] {
  const orgId = input.orgId ?? null;
  const uncoveredPicks = input.uncoveredPicks ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team before logging picks.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Credit stays blank until your team enters match rows.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Pick lists stay empty until real metrics exist.",
          href: hubHref("/competition", "strategy", null),
        },
        {
          id: "accuracy",
          label: "Open Accuracy",
          detail: "Ranks stay blank until TBA-verified totals exist.",
          href: withOrgHref("/scout-accuracy", null),
        },
      ];
    }
    return [
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Log alliance picks at the desk so scout credit can attach.",
        href: hubHref("/competition", "strategy", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Keep match-scout rows for teams that may be picked.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "TBA-verified ranks explain why a scout earned a seat.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
      {
        id: "command",
        label: "Set active event",
        detail: "Confirm the event so picks and scout rows stay aligned.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry scout data impact",
        detail: "Reload real pick credit.",
        href: withOrgHref("/scout-data-impact", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while impact reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Pick desk stays available while impact reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Accuracy ranks stay available while impact reloads.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "log-pick",
        label: "Log an alliance pick",
        detail: "Credit appears only after a real pick is logged.",
        href: "#log-alliance-pick",
        primary: true,
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Save pick lists at the desk, then return here for scout credit.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Match-scout the teams you expect to pick.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "accuracy",
        label: "Open Accuracy",
        detail: "Seat accurate scouts so their credit shows up after picks.",
        href: withOrgHref("/scout-accuracy", orgId),
      },
    ];
  }

  return [
    {
      id: "picks",
      label:
        uncoveredPicks > 0
          ? `Scout ${uncoveredPicks} uncovered pick${uncoveredPicks === 1 ? "" : "s"}`
          : "Review where data went",
      detail:
        uncoveredPicks > 0
          ? "Some logged picks still have no matching scout entries."
          : "Every logged pick has at least one attributable scout entry.",
      href: uncoveredPicks > 0 ? hubHref("/competition", "scouting", orgId) : "#pick-evidence",
      primary: true,
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Keep the pick desk in sync with logged alliance selections.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Add match rows for teams that still lack attributable entries.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "accuracy",
      label: "Open Accuracy",
      detail: "Cross-check TBA ranks against who earned pick credit.",
      href: withOrgHref("/scout-accuracy", orgId),
    },
  ];
}
