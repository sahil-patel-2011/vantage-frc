import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout Field-Count Budget (never DEMO field totals). */
export const SCOUT_FIELD_BUDGET_RELATED_LINKS = [
  { id: "forms", label: "Form builder", kind: "hub" as const, tab: "forms" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "coverage", label: "Coverage Live", kind: "hub" as const, tab: "scout-coverage-live" },
] as const;

export type ScoutFieldBudgetRelatedId = (typeof SCOUT_FIELD_BUDGET_RELATED_LINKS)[number]["id"];

export type ScoutFieldBudgetRelatedLink = {
  id: ScoutFieldBudgetRelatedId;
  label: string;
  href: string;
};

export const SCOUT_FIELD_BUDGET_RELATED_INCLUDE: ScoutFieldBudgetRelatedId[] = [
  "forms",
  "scouting",
  "coverage",
];

/**
 * Soft-UI cross-links from Field-Count Budget → Forms / Scouting / Coverage.
 * Build with hubHref — never broken JSX href templates.
 */
export function scoutFieldBudgetRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScoutFieldBudgetRelatedId; include?: ScoutFieldBudgetRelatedId[] },
): ScoutFieldBudgetRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCOUT_FIELD_BUDGET_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/competition", link.tab, orgId),
  }));
}

export type ScoutFieldBudgetShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScoutFieldBudgetNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type ScoutFieldBudgetEmptyCopy = {
  kind: ScoutFieldBudgetShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type ScoutFieldBudgetSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function scoutFieldBudgetSetupSteps(orgId?: string | null): ScoutFieldBudgetSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open field budgets.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "forms",
      label: "Open Form builder",
      detail: "Build the real scouting form first, then check how many fields each part of the match asks for.",
      href: hubHref("/competition", "forms", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live match forms stay blank until scouts log real rows.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

/** Real snapshot / over-budget counts only — never invent DEMO totals. */
export function formatScoutFieldBudgetMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no schemas are linted — avoids DEMO counters. */
export function shouldShowScoutFieldBudgetSummaryTiles(snapshotCount: number): boolean {
  return snapshotCount > 0;
}

/** Classify Field-Count Budget Soft-UI shell — never invents DEMO field totals. */
export function classifyScoutFieldBudgetShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  snapshotCount?: number;
}): ScoutFieldBudgetShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.snapshotCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO field totals. */
export function scoutFieldBudgetShellCopy(kind: ScoutFieldBudgetShellKind): ScoutFieldBudgetEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Field-Count Budget…",
        description: "Checking which team you are on and the forms you have checked.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Field-Count Budget",
        description:
          "This page could not load. Retry, or open Form builder while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before checking a form.",
      };
    case "empty":
      return {
        kind,
        badge: "No forms checked yet",
        title: "Check your first form",
        description:
          "Enter how many fields each part of the match asks for, and see whether a scout can fill them in time.",
      };
    default:
      return {
        kind: "ready",
        title: "Form length check",
        description: "From the forms you have checked.",
      };
  }
}

/**
 * Soft-UI next actions for Field-Count Budget empty/setup shells.
 * Points at Forms / Scouting / Coverage — never invents DEMO field totals.
 */
export function scoutFieldBudgetNextActions(input: {
  orgId?: string | null;
  shell: ScoutFieldBudgetShellKind;
  snapshotCount?: number;
  overBudgetCount?: number;
}): ScoutFieldBudgetNextAction[] {
  const orgId = input.orgId ?? null;
  const snapshotCount = input.snapshotCount ?? 0;
  const overBudgetCount = input.overBudgetCount ?? 0;

  // One source for the setup path. These used to be two hand-written lists
  // that happened to look like the setup steps, so removing a link from the
  // steps left the actions saying something different — which is the drift
  // `setupActionsFrom` exists to stop.
  if (!orgId || input.shell === "setup") {
    return setupActionsFrom(scoutFieldBudgetSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Field-Count Budget",
        detail: "Reload the forms you have checked.",
        href: withOrgHref("/scout-field-budget", orgId),
        primary: true,
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Form builder stays available while this page reloads.",
        href: hubHref("/competition", "forms", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scouting stays available while the linter reloads.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  if (input.shell === "empty" || snapshotCount === 0) {
    return [
      {
        id: "lint-schema",
        label: "Lint the first schema",
        detail: "Snapshots stay blank until you log real phase field counts.",
        href: "#scout-field-budget-lint",
        primary: true,
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Count fields from the live scouting form.",
        href: hubHref("/competition", "forms", orgId),
      },
    ];
  }

  return [
    {
      id: overBudgetCount > 0 ? "trim-over-budget" : "review-lints",
      label: overBudgetCount > 0 ? "Trim over-budget schemas" : "Review linted schemas",
      detail:
        overBudgetCount > 0
          ? `${overBudgetCount} schema${overBudgetCount === 1 ? "" : "s"} over budget from real field counts.`
          : `${snapshotCount} linted schema${snapshotCount === 1 ? "" : "s"} from logged snapshots.`,
      href: "#scout-field-budget-list",
      primary: true,
    },
    {
      id: "forms",
      label: "Open Form builder",
      detail: "Edit the scouting form that drove the lint.",
      href: hubHref("/competition", "forms", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Carry the budget into live match entry.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "coverage",
      label: "Open Coverage Live",
      detail: "Coverage gaps stay honest once the form fits the budget.",
      href: hubHref("/competition", "scout-coverage-live", orgId),
    },
  ];
}
