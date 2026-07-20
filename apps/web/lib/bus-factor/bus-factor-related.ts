import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Bus-Factor & Burnout Watch (never DEMO risk metrics). */
export const BUS_FACTOR_RELATED_LINKS = [
  { id: "attendance", label: "Attendance", tab: "attendance" },
  { id: "hours-self-view", label: "My Hours", tab: "hours-self-view" },
  { id: "task-board", label: "Task board", tab: "task-board" },
  { id: "knowledge", label: "Knowledge", tab: "knowledge" },
] as const;

export type BusFactorRelatedId = (typeof BUS_FACTOR_RELATED_LINKS)[number]["id"];

export type BusFactorRelatedLink = {
  id: BusFactorRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Attendance / My Hours / Task board. */
export const BUS_FACTOR_RELATED_INCLUDE: BusFactorRelatedId[] = [
  "attendance",
  "hours-self-view",
  "task-board",
];

/**
 * Soft-UI cross-links from Bus-Factor → Attendance / Hours / Task board.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function busFactorRelatedLinks(
  orgId?: string | null,
  options?: { active?: BusFactorRelatedId; include?: BusFactorRelatedId[] },
): BusFactorRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return BUS_FACTOR_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type BusFactorShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type BusFactorNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type BusFactorEmptyCopy = {
  kind: BusFactorShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO risk metrics. */
export type BusFactorSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function busFactorSetupSteps(orgId?: string | null): BusFactorSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — Bus-Factor is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Presence stays blank until real check-ins exist — never DEMO headcount.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "hours-self-view",
      label: "Open My Hours",
      detail: "Clocked hours stay blank until members log shop time — never DEMO hours.",
      href: hubHref("/team", "hours-self-view", orgId),
    },
    {
      id: "task-board",
      label: "Open Task board",
      detail: "Ownership stays empty without real task rows — never DEMO progress.",
      href: hubHref("/team", "task-board", orgId),
    },
  ];
}

/** Real entry / hour counts only — never invent DEMO totals. */
export function formatBusFactorMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Real percent / ratio only — never invent DEMO risk scores. */
export function formatBusFactorPercent(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0%";
  return `${Math.round(Math.min(1, n) * 100)}%`;
}

/** Hide zeroed summary tiles when no entries exist — avoids DEMO counters. */
export function shouldShowBusFactorSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

/** True when the workspace has no workload entries yet — Soft-UI empty. */
export function isBusFactorBoardEmpty(input: { entryCount: number }): boolean {
  return input.entryCount === 0;
}

/** Classify Bus-Factor Soft-UI shell — never invents DEMO risk metrics. */
export function classifyBusFactorShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): BusFactorShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isBusFactorBoardEmpty({ entryCount: input.entryCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO risk metrics. */
export function busFactorShellCopy(kind: BusFactorShellKind): BusFactorEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Bus-Factor & Burnout…",
        description:
          "Checking workspace membership and logged workload entries — never DEMO risk scores.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Bus-Factor",
        description:
          "A network or server issue blocked workload risk. Retry, or open Attendance / My Hours while it reloads — never invent DEMO risk metrics.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Bus-Factor is org-scoped. Pick a workspace before logging weekly workload — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No entries yet",
        title: "Log your first weekly workload entry",
        description:
          "Track hours, tasks owned, and sole-knowledge counts per member and area. Risk stays blank until you log real rows — never DEMO burnout scores.",
      };
    default:
      return {
        kind: "ready",
        title: "Bus-factor from logged workload",
        description:
          "Concentration and overload use only what the team logs — never DEMO risk metrics.",
      };
  }
}

/**
 * Soft-UI next actions for Bus-Factor empty/setup shells.
 * Points at Attendance / My Hours / Task board — never invents DEMO risk metrics.
 */
export function busFactorNextActions(input: {
  orgId?: string | null;
  shell: BusFactorShellKind;
  entryCount?: number;
  flagCount?: number;
}): BusFactorNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;
  const flagCount = input.flagCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Bus-factor risk is org-scoped — pick a team before logging workload.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "attendance",
          label: "Open Attendance",
          detail: "Presence stays blank until real check-ins exist — never DEMO headcount.",
          href: hubHref("/team", "attendance", null),
        },
        {
          id: "hours-self-view",
          label: "Open My Hours",
          detail: "Clocked hours stay blank until members log shop time — never DEMO hours.",
          href: hubHref("/team", "hours-self-view", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Bus-Factor can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "attendance",
        label: "Open Attendance",
        detail: "Confirm who is active before logging weekly workload.",
        href: hubHref("/team", "attendance", orgId),
      },
      {
        id: "hours-self-view",
        label: "Open My Hours",
        detail: "Corroborate self-reported hours with real clocked shop time.",
        href: hubHref("/team", "hours-self-view", orgId),
      },
      {
        id: "task-board",
        label: "Open Task board",
        detail: "Ownership concentration pairs with sole-knowledge flags.",
        href: hubHref("/team", "task-board", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Bus-Factor",
        detail: "Reload real workload entries — nothing is invented while this fails.",
        href: withOrgHref("/bus-factor", orgId),
        primary: true,
      },
      {
        id: "attendance",
        label: "Open Attendance",
        detail: "Presence stays available while risk reloads.",
        href: hubHref("/team", "attendance", orgId),
      },
      {
        id: "hours-self-view",
        label: "Open My Hours",
        detail: "Clocked hours stay available while risk reloads.",
        href: hubHref("/team", "hours-self-view", orgId),
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "log",
        label: "Log a weekly workload entry",
        detail: "Hours, tasks owned, and sole-knowledge counts stay blank until you log them — never DEMO risk.",
        href: "#bus-factor-log",
        primary: true,
      },
      {
        id: "hours-self-view",
        label: "Open My Hours",
        detail: "Compare self-reported workload against clocked Build Hours.",
        href: hubHref("/team", "hours-self-view", orgId),
      },
      {
        id: "attendance",
        label: "Open Attendance",
        detail: "Confirm active members before attributing concentration risk.",
        href: hubHref("/team", "attendance", orgId),
      },
      {
        id: "task-board",
        label: "Open Task board",
        detail: "Ownership on the season board pairs with sole-knowledge flags.",
        href: hubHref("/team", "task-board", orgId),
      },
    ];
  }

  return [
    {
      id: "review",
      label: flagCount > 0 ? "Review risk flags" : "Log another week",
      detail:
        flagCount > 0
          ? `${flagCount} flag${flagCount === 1 ? "" : "s"} from logged rows only — never DEMO scores.`
          : `${entryCount} entr${entryCount === 1 ? "y" : "ies"} on file — keep logging real weeks.`,
      href: flagCount > 0 ? "#bus-factor-risk" : "#bus-factor-log",
      primary: true,
    },
    {
      id: "hours-self-view",
      label: "Open My Hours",
      detail: "Corroborate self-reported hours with clocked shop time.",
      href: hubHref("/team", "hours-self-view", orgId),
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Presence context for who is carrying load this window.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "task-board",
      label: "Open Task board",
      detail: "Day-to-day ownership lives beside concentration risk.",
      href: hubHref("/team", "task-board", orgId),
    },
  ];
}
