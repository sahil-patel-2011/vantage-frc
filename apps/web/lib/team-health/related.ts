import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Team Health (never DEMO morale). */
export const TEAM_HEALTH_RELATED_LINKS = [
  { id: "attendance", label: "Attendance", tab: "attendance" },
  { id: "hours-self-view", label: "My hours", tab: "hours-self-view" },
  { id: "hours", label: "Shop hours", tab: "hours" },
] as const;

export type TeamHealthRelatedId = (typeof TEAM_HEALTH_RELATED_LINKS)[number]["id"];

export type TeamHealthRelatedLink = {
  id: TeamHealthRelatedId;
  label: string;
  href: string;
};

export const TEAM_HEALTH_RELATED_INCLUDE: TeamHealthRelatedId[] = ["attendance", "hours-self-view"];

/**
 * Soft-UI cross-links from Team Health → Attendance / My hours.
 * Build with hubHref — never broken JSX href templates.
 */
export function teamHealthRelatedLinks(
  orgId?: string | null,
  options?: { active?: TeamHealthRelatedId; include?: TeamHealthRelatedId[] },
): TeamHealthRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return TEAM_HEALTH_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => ({
    id: link.id,
    label: link.label,
    href: hubHref("/team", link.tab, orgId),
  }));
}

export type TeamHealthShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type TeamHealthNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type TeamHealthEmptyCopy = {
  kind: TeamHealthShellKind;
  badge?: string;
  title: string;
  description: string;
};

export type TeamHealthSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function teamHealthSetupSteps(orgId?: string | null): TeamHealthSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Team Health.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Engagement stays blank until real roll-call entries exist.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "hours-self-view",
      label: "Open My hours",
      detail: "Shop-time engagement stays blank until members clock in.",
      href: hubHref("/team", "hours-self-view", orgId),
    },
  ];
}

/** Real counts only — never invent DEMO morale or engagement totals. */
export function formatTeamHealthMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hours with one decimal from real logs — blank until loaded. */
export function formatTeamHealthHours(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return `${Math.round(n * 10) / 10}`;
}

/** Rate from real logs — blank until a computable rate exists. */
export function formatTeamHealthRate(value: number | null | undefined, loaded: boolean): string {
  if (!loaded) return "…";
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

/** Hide zeroed summary tiles when no logs exist — avoids DEMO counters. */
export function shouldShowTeamHealthSummaryTiles(hasLogs: boolean): boolean {
  return hasLogs;
}

/** Classify Team Health Soft-UI shell — never invents DEMO morale. */
export function classifyTeamHealthShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  hasLogs?: boolean;
}): TeamHealthShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (!input.hasLogs) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO morale scores. */
export function teamHealthShellCopy(kind: TeamHealthShellKind): TeamHealthEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Team Health…",
        description: "Checking which team you are on and attendance / hour logs.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Team Health",
        description:
          "A network or server issue blocked the engagement view. Retry, or open Attendance while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team before reading attendance and hour logs.",
      };
    case "empty":
      return {
        kind,
        badge: "No logs yet",
        title: "Engagement stays empty until someone logs time",
        description:
          "Team Health is built from attendance roll call and shop-hour clock-ins only.",
      };
    default:
      return {
        kind: "ready",
        title: "Engagement from logs",
        description: "Attendance roll call and shop hours only.",
      };
  }
}

/**
 * Soft-UI next actions for Team Health empty/setup shells.
 * Points at Attendance / My hours — never invents DEMO morale.
 */
export function teamHealthNextActions(input: {
  orgId?: string | null;
  shell: TeamHealthShellKind;
  hasLogs?: boolean;
  checkInCount?: number;
}): TeamHealthNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    // One list, not two: the setup shell offers exactly the setup steps. These
    // used to be a second hand-written copy of teamHealthSetupSteps with the same ids and
    // different wording, so the screen showed the same guided list twice.
    return setupActionsFrom(teamHealthSetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Team Health",
        detail: "Reload real attendance and hour logs.",
        href: withOrgHref("/team-health-dashboard", orgId),
        primary: true,
      },
      {
        id: "attendance",
        label: "Open Attendance",
        detail: "Attendance stays available while Team Health reloads.",
        href: hubHref("/team", "attendance", orgId),
      },
      {
        id: "hours-self-view",
        label: "Open My hours",
        detail: "My hours stays available while Team Health reloads.",
        href: hubHref("/team", "hours-self-view", orgId),
      },
    ];
  }

  if (input.shell === "empty" || !input.hasLogs) {
    return [
      {
        id: "attendance",
        label: "Log attendance",
        detail: "Take roll call so engagement has real presence.",
        href: hubHref("/team", "attendance", orgId),
        primary: true,
      },
      {
        id: "hours-self-view",
        label: "Clock in",
        detail: "Shop sessions appear here after real clock-ins.",
        href: hubHref("/team", "hours-self-view", orgId),
      },
      {
        id: "hours",
        label: "Open shop hours",
        detail: "Kiosk clock-ins also count toward engagement.",
        href: hubHref("/team", "hours", orgId),
      },
    ];
  }

  const checkInCount = input.checkInCount ?? 0;
  return [
    {
      id: checkInCount > 0 ? "check-ins" : "review",
      label: checkInCount > 0 ? "Review members without logs" : "Review engagement",
      detail:
        checkInCount > 0
          ? `${checkInCount} roster member(s) have no attendance or hours this season.`
          : "Attendance and shop hours from this season.",
      href: checkInCount > 0 ? "#team-health-checkins" : "#team-health-members",
      primary: true,
    },
    {
      id: "attendance",
      label: "Open Attendance",
      detail: "Add the next roll call.",
      href: hubHref("/team", "attendance", orgId),
    },
    {
      id: "hours-self-view",
      label: "Open My hours",
      detail: "Clock the next shop session.",
      href: hubHref("/team", "hours-self-view", orgId),
    },
  ];
}
