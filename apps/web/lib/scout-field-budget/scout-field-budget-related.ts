import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Scout Field-Count Budget (never DEMO field totals). */
export const SCOUT_FIELD_BUDGET_RELATED_LINKS = [
  { id: "forms", label: "Form builder", kind: "hub" as const, tab: "forms" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "schema-ab", label: "Schema A/B", kind: "hub" as const, tab: "scouting-schema-ab" },
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
  "schema-ab",
];

/**
 * Soft-UI cross-links from Field-Count Budget → Forms / Scouting / Schema A/B.
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
      detail: "Draft the real scouting schema before linting phase field counts.",
      href: hubHref("/competition", "forms", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live match forms stay blank until scouts log real rows.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "schema-ab",
      label: "Open Schema A/B",
      detail: "Compare schema variants after you lint the field-count budget.",
      href: hubHref("/competition", "scouting-schema-ab", orgId),
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
        description: "Checking which team you are on and schema snapshots.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Field-Count Budget",
        description:
          "A network or server issue blocked the linter. Retry, or open Form builder while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before linting schema phases.",
      };
    case "empty":
      return {
        kind,
        badge: "No schemas linted yet",
        title: "Log your first schema snapshot",
        description:
          "Record how many fields each match phase asks for and lint against a realistic per-match budget.",
      };
    default:
      return {
        kind: "ready",
        title: "Schema field-count lint",
        description: "Budgets from logged schemas only.",
      };
  }
}

/**
 * Soft-UI next actions for Field-Count Budget empty/setup shells.
 * Points at Forms / Scouting / Schema A/B — never invents DEMO field totals.
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

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before linting schemas.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "forms",
          label: "Open Form builder",
          detail: "Schemas stay blank until your team drafts real forms.",
          href: hubHref("/competition", "forms", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Match forms stay empty until scouts log real rows.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership setup so Field-Count Budget can load.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Draft the schema you want to lint.",
        href: hubHref("/competition", "forms", orgId),
      },
      {
        id: "schema-ab",
        label: "Open Schema A/B",
        detail: "Compare variants after the first lint lands.",
        href: hubHref("/competition", "scouting-schema-ab", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Field-Count Budget",
        detail: "Reload real schema snapshots.",
        href: withOrgHref("/scout-field-budget", orgId),
        primary: true,
      },
      {
        id: "forms",
        label: "Open Form builder",
        detail: "Form builder stays available while the linter reloads.",
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
      {
        id: "schema-ab",
        label: "Open Schema A/B",
        detail: "A/B variants stay empty until schemas exist.",
        href: hubHref("/competition", "scouting-schema-ab", orgId),
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
