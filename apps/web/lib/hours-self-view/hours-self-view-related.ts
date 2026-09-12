import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for My hours (never DEMO hour totals). */
export const HOURS_SELF_VIEW_RELATED_LINKS = [
  { id: "attendance", label: "Attendance", tab: "attendance" },
  { id: "mentor-hours", label: "Mentor hours", tab: "mentor-hours" },
  { id: "team-health-dashboard", label: "Team health", tab: "team-health-dashboard" },
  { id: "goals-tracker", label: "Season Goals", tab: "goals-tracker" },
] as const;

export type HoursSelfViewRelatedId = (typeof HOURS_SELF_VIEW_RELATED_LINKS)[number]["id"];

export type HoursSelfViewRelatedLink = {
  id: HoursSelfViewRelatedId;
  label: string;
  href: string;
};

export const HOURS_SELF_VIEW_RELATED_INCLUDE: HoursSelfViewRelatedId[] = [
  "attendance",
  "mentor-hours",
  "team-health-dashboard",
];

/**
 * Soft-UI cross-links from My hours → Attendance / Mentor hours / Team health.
 * Build with hubHref — never broken JSX href templates.
 */
export function hoursSelfViewRelatedLinks(
  orgId?: string | null,
  options?: { active?: HoursSelfViewRelatedId; include?: HoursSelfViewRelatedId[] },
): HoursSelfViewRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return HOURS_SELF_VIEW_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type HoursSelfViewShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type HoursSelfViewNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type HoursSelfViewEmptyCopy = {
  kind: HoursSelfViewShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type HoursSelfViewSetupStepLink = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function hoursSelfViewSetupSteps(orgId?: string | null): HoursSelfViewSetupStepLink[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open My hours.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
  ];
}

/** Real session / hour counts only — never invent DEMO totals. */
export function formatHoursSelfViewMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hours with one decimal from real minutes — blank until loaded; never DEMO hours. */
export function formatHoursSelfViewHours(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return `${Math.round(n * 10) / 10}`;
}

/** Hide zeroed summary tiles when no sessions exist — avoids DEMO counters. */
export function shouldShowHoursSelfViewSummaryTiles(entryCount: number): boolean {
  return entryCount > 0;
}

/** Classify My hours Soft-UI shell — never invents DEMO hour totals. */
export function classifyHoursSelfViewShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  entryCount?: number;
}): HoursSelfViewShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if ((input.entryCount ?? 0) === 0) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO hour totals. */
export function hoursSelfViewShellCopy(kind: HoursSelfViewShellKind): HoursSelfViewEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Opening My hours",
        description: "Checking which team you are on and your sessions.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load My hours",
        description:
          "A network or server issue blocked your hours. Retry, or open Attendance while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before reading your logged sessions.",
      };
    case "empty":
      return {
        kind,
        badge: "No hours yet",
        title: "Clock in to start your record",
        description:
          "Shop, meeting, and outreach sessions appear here after real clock-ins.",
      };
    case "ready":
      return {
        kind,
        title: "Your logged hours",
        description: "Sessions from your clock-ins only.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
  }
}

/**
 * Soft-UI next actions for My hours empty/setup shells.
 * Clock in lives on this board — never invents DEMO hour totals.
 */
export function hoursSelfViewNextActions(input: {
  orgId?: string | null;
  shell: HoursSelfViewShellKind;
  entryCount?: number;
  kioskCount?: number;
}): HoursSelfViewNextAction[] {
  const orgId = input.orgId ?? null;
  const entryCount = input.entryCount ?? 0;

  if (!orgId || input.shell === "setup") {
    const step = hoursSelfViewSetupSteps(orgId)[0]!;
    return [
      {
        id: step.id,
        label: step.label,
        detail: step.detail,
        href: step.href,
        primary: true,
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry My hours",
        detail: "Reload your hours.",
        href: withOrgHref("/hours-self-view", orgId),
        primary: true,
      },
    ];
  }

  if (input.shell === "empty" || entryCount === 0) {
    return [
      {
        id: "clock-in",
        label: "Clock in",
        detail: "Start a shop session on this board.",
        href: "#hours-clock",
        primary: true,
      },
    ];
  }

  return [
    {
      id: "review-sessions",
      label: "Review recent sessions",
      detail: `${entryCount} session${entryCount === 1 ? "" : "s"} from your clock-ins.`,
      href: "#hours-self-entries",
      primary: true,
    },
  ];
}
