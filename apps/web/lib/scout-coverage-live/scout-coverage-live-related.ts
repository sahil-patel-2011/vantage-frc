import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout Coverage Live (never DEMO coverage %). */
export const SCOUT_COVERAGE_LIVE_RELATED_LINKS = [
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "lineup", label: "Lineup", kind: "path" as const, path: "/scouting/lineup" },
  { id: "crossval", label: "Cross-Validation", kind: "path" as const, path: "/scout-crossval" },
  { id: "accuracy", label: "Accuracy", kind: "path" as const, path: "/scout-accuracy" },
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
] as const;

export type ScoutCoverageLiveRelatedId = (typeof SCOUT_COVERAGE_LIVE_RELATED_LINKS)[number]["id"];

export type ScoutCoverageLiveRelatedLink = {
  id: ScoutCoverageLiveRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Scouting · Lineup · Cross-Validation. */
export const SCOUT_COVERAGE_LIVE_RELATED_INCLUDE: ScoutCoverageLiveRelatedId[] = [
  "scouting",
  "lineup",
  "crossval",
];

export function scoutCoverageLiveRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutCoverageLiveRelatedId; include?: ScoutCoverageLiveRelatedId[] },
): ScoutCoverageLiveRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUT_COVERAGE_LIVE_RELATED_LINKS.filter((link) => {
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

export type ScoutCoverageLiveShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutCoverageLiveNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutCoverageLiveEmptyCopy = {
  kind: ScoutCoverageLiveShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ScoutCoverageLiveSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutCoverageLiveSetupSteps(orgId?: string | null): ScoutCoverageLiveSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — coverage is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "command",
      label: "Set active event",
      detail: "Pin the TBA event so the live grid can read the real match schedule.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Log real match-scout rows — gaps stay honest until then, never DEMO coverage.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "lineup",
      label: "Open Lineup",
      detail: "Balance scout assignments so zero/thin cells can clear mid-event.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "crossval",
      label: "Open Cross-Validation",
      detail: "Once covered, check scout totals against cached TBA results.",
      href: withOrgHref("/scout-crossval", orgId),
    },
  ];
}

/** Real counts only — never invent DEMO totals. */
export function formatScoutCoverageLiveMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/**
 * Coverage rate 0..1 from real schedule cells — blank until loaded; never DEMO %.
 * Null / no schedule renders as an em dash, not 0%.
 */
export function formatScoutCoverageLiveRate(
  value: unknown,
  loaded: boolean,
  options?: { hasSchedule?: boolean },
): string {
  if (!loaded) return "…";
  if (options?.hasSchedule === false) return "—";
  if (value == null) return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return "—";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed KPI tiles when nothing is scheduled — avoids DEMO coverage. */
export function shouldShowScoutCoverageLiveSummaryTiles(input: {
  totalCells: number;
}): boolean {
  return input.totalCells > 0;
}

/** True when the live grid has no schedule cells — Soft-UI empty. */
export function isScoutCoverageLiveEmpty(input: { totalCells: number }): boolean {
  return input.totalCells === 0;
}

/** Classify Scout Coverage Live Soft-UI shell — never invents DEMO coverage. */
export function classifyScoutCoverageLiveShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  totalCells?: number;
}): ScoutCoverageLiveShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isScoutCoverageLiveEmpty({ totalCells: input.totalCells ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO coverage. */
export function scoutCoverageLiveShellCopy(kind: ScoutCoverageLiveShellKind): ScoutCoverageLiveEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading scout coverage…",
        description:
          "Checking workspace membership and the real match schedule — never DEMO coverage gaps.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load scout coverage",
        description:
          "A network or server issue blocked the live grid. Retry, or open Scouting / Lineup / Cross-Validation while it reloads — never invent DEMO gaps.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Live coverage is org-scoped. Pick a workspace and active event before zero/thin cells appear — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No schedule yet",
        title: "Waiting on a real match schedule",
        description:
          "The grid stays blank until the active event has synced TBA alliances. Cross-check Event Day, Scouting, and Lineup — never DEMO coverage.",
      };
    default:
      return {
        kind: "ready",
        title: "Live coverage gaps",
        description:
          "Zero and thin cells use real scout-entry counts against the synced schedule — never DEMO coverage.",
      };
  }
}

/**
 * Soft-UI next actions for Scout Coverage Live empty/setup shells.
 * Points at Scouting / Lineup / Cross-Validation — never invents DEMO gaps.
 */
export function scoutCoverageLiveNextActions(input: {
  orgId?: string | null;
  shell: ScoutCoverageLiveShellKind;
  gapCount?: number;
  unackedNudges?: number;
}): ScoutCoverageLiveNextAction[] {
  const orgId = input.orgId ?? null;
  const gapCount = input.gapCount ?? 0;
  const unackedNudges = input.unackedNudges ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Coverage is org-scoped — pick a team before watching live gaps.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Scout rows stay blank until your team enters them — never DEMO coverage.",
          href: hubHref("/competition", "scouting", null),
        },
        {
          id: "lineup",
          label: "Open Lineup",
          detail: "Assignments stay honest until real scouts are seated.",
          href: withOrgHref("/scouting/lineup", null),
        },
        {
          id: "crossval",
          label: "Open Cross-Validation",
          detail: "TBA checks stay blank until real scout totals exist.",
          href: withOrgHref("/scout-crossval", null),
        },
      ];
    }
    return [
      {
        id: "command",
        label: "Set active event",
        detail: "Confirm the TBA event so the schedule can populate the grid.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Log match-scout rows so zero/thin cells can clear — never DEMO coverage.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "lineup",
        label: "Open Lineup",
        detail: "Balance shifts so every robot has a real scout assignment.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "crossval",
        label: "Open Cross-Validation",
        detail: "After coverage lands, compare totals to cached TBA results.",
        href: withOrgHref("/scout-crossval", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry scout coverage",
        detail: "Reload real schedule gaps — nothing is pre-seeded while this fails.",
        href: withOrgHref("/scout-coverage-live", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout rows stay available while the grid reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "lineup",
        label: "Open Lineup",
        detail: "Lineup coverage stays available while the grid reloads.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "crossval",
        label: "Open Cross-Validation",
        detail: "TBA cross-checks stay available while coverage reloads.",
        href: withOrgHref("/scout-crossval", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "command",
        label: "Sync event schedule",
        detail: "The grid needs cached TBA alliances before gaps can appear.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Membership-bound scout rows stay ready once the schedule lands.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "lineup",
        label: "Open Lineup",
        detail: "Seat scouts so coverage can clear as soon as matches sync.",
        href: withOrgHref("/scouting/lineup", orgId),
      },
      {
        id: "crossval",
        label: "Open Cross-Validation",
        detail: "TBA field checks wait on the same real scout data.",
        href: withOrgHref("/scout-crossval", orgId),
      },
    ];
  }

  return [
    {
      id: "gaps",
      label:
        gapCount > 0
          ? `Close ${gapCount} coverage gap${gapCount === 1 ? "" : "s"}`
          : unackedNudges > 0
            ? `Acknowledge ${unackedNudges} nudge${unackedNudges === 1 ? "" : "s"}`
            : "Review live coverage",
      detail:
        gapCount > 0
          ? "Nudge the coordinator on zero/thin cells from real entry counts — never DEMO gaps."
          : unackedNudges > 0
            ? "Confirm coordinator nudges once scouts are seated."
            : "Every scheduled team/match meets the thin threshold from real entries.",
      href: gapCount > 0 ? "#coverage-gaps" : unackedNudges > 0 ? "#nudge-log" : hubHref("/competition", "scouting", orgId),
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Keep logging membership-bound match rows to clear thin cells.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "lineup",
      label: "Open Lineup",
      detail: "Rebalance assignments against the live gap list.",
      href: withOrgHref("/scouting/lineup", orgId),
    },
    {
      id: "crossval",
      label: "Open Cross-Validation",
      detail: "Spot TBA conflicts on covered robots next.",
      href: withOrgHref("/scout-crossval", orgId),
    },
  ];
}
