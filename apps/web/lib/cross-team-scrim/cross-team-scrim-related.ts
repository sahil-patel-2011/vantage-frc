import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Cross-Team Scrim Scheduling (never DEMO scrim metrics). */
export const CROSS_TEAM_SCRIM_RELATED_LINKS = [
  { id: "calendar", label: "Calendar", kind: "team" as const, tab: "calendar" },
  { id: "scouting", label: "Scouting", kind: "competition" as const, tab: "scouting" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
  { id: "team", label: "Team hub", kind: "team" as const, tab: "cross-team-scrim" },
] as const;

export type CrossTeamScrimRelatedId = (typeof CROSS_TEAM_SCRIM_RELATED_LINKS)[number]["id"];

export type CrossTeamScrimRelatedLink = {
  id: CrossTeamScrimRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Calendar · Scouting · Team Data. */
export const CROSS_TEAM_SCRIM_RELATED_INCLUDE: CrossTeamScrimRelatedId[] = [
  "calendar",
  "scouting",
  "team-data",
];

/**
 * Soft-UI cross-links from Cross-Team Scrim → Calendar / Scouting / Team Data.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function crossTeamScrimRelatedLinks(
  orgId?: string | null,
  options?: { active?: CrossTeamScrimRelatedId; include?: CrossTeamScrimRelatedId[] },
): CrossTeamScrimRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return CROSS_TEAM_SCRIM_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type CrossTeamScrimShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type CrossTeamScrimNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type CrossTeamScrimEmptyCopy = {
  kind: CrossTeamScrimShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO scrim metrics. */
export type CrossTeamScrimSetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function crossTeamScrimSetupSteps(orgId?: string | null): CrossTeamScrimSetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — scrim invites are org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "calendar",
      label: "Open Calendar",
      detail: "Confirm practice/event windows before proposing dates — never DEMO schedules.",
      href: hubHref("/team", "calendar", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Data-share scopes use real scout sheets only — never invent DEMO partners.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "team-data",
      label: "Open Team Data",
      detail: "Confirm TBA/team context for partner outreach — never DEMO team numbers.",
      href: withOrgHref("/team/data", orgId),
    },
  ];
}

/** Real invite counts only — never invent DEMO totals. */
export function formatCrossTeamScrimMetric(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** Hide zeroed summary tiles when no invites exist — avoids DEMO counters. */
export function shouldShowCrossTeamScrimSummaryTiles(input: {
  inviteCount: number;
  upcomingCount: number;
}): boolean {
  return input.inviteCount > 0 || input.upcomingCount > 0;
}

/** True when the workspace has no scrim invites yet — Soft-UI empty. */
export function isCrossTeamScrimBoardEmpty(input: { inviteCount: number }): boolean {
  return input.inviteCount === 0;
}

/** Classify Cross-Team Scrim Soft-UI shell — never invents DEMO scrim metrics. */
export function classifyCrossTeamScrimShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "live" | null;
  orgId?: string | null;
  inviteCount?: number;
}): CrossTeamScrimShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed) return "error";
  if (input.status === "setup_required" || !input.orgId) return "setup";
  if (isCrossTeamScrimBoardEmpty({ inviteCount: input.inviteCount ?? 0 })) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO scrim metrics. */
export function crossTeamScrimShellCopy(kind: CrossTeamScrimShellKind): CrossTeamScrimEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading Cross-Team Scrims…",
        description:
          "Checking workspace membership and real scrim invites — never DEMO partners.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load scrim scheduling",
        description:
          "A network or server issue blocked invites. Retry, or open Calendar / Scouting / Team Data while it reloads — never invent DEMO scrim metrics.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "Scrim scheduling is org-scoped. Join or pick a workspace before proposing nearby partners — nothing is pre-seeded.",
      };
    case "empty":
      return {
        kind,
        badge: "No invites yet",
        title: "Propose a scrimmage with a nearby team",
        description:
          "Invites and data-share agreements stay blank until you log a real partner. Cross-check Calendar, Scouting, and Team Data — never DEMO partners.",
      };
    default:
      return {
        kind: "ready",
        title: "Scrim invites",
        description:
          "Only real partner invites and agreed data-share scopes appear here — counts never invent DEMO metrics.",
      };
  }
}

/**
 * Soft-UI next actions for Cross-Team Scrim empty/setup shells.
 * Points at Calendar / Scouting / Team Data — never invents DEMO scrim metrics.
 */
export function crossTeamScrimNextActions(input: {
  orgId?: string | null;
  shell: CrossTeamScrimShellKind;
  inviteCount?: number;
  upcomingCount?: number;
}): CrossTeamScrimNextAction[] {
  const orgId = input.orgId ?? null;
  const inviteCount = input.inviteCount ?? 0;
  const upcomingCount = input.upcomingCount ?? 0;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Scrim invites are org-scoped — pick a team before proposing partners.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "calendar",
          label: "Open Calendar",
          detail: "Practice windows stay blank until real events exist — never DEMO schedules.",
          href: hubHref("/team", "calendar", null),
        },
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Data-share stays empty without real scout sheets — never DEMO partners.",
          href: hubHref("/competition", "scouting", null),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership setup so Scrim Scheduling can resolve your organization.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Confirm practice/event windows before proposing dates.",
        href: hubHref("/team", "calendar", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Agree data-share scopes against real scout sheets only.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "team-data",
        label: "Open Team Data",
        detail: "Confirm TBA/team context for partner outreach — never DEMO numbers.",
        href: withOrgHref("/team/data", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Scrim Scheduling",
        detail: "Reload real invites — nothing is pre-seeded while this fails.",
        href: withOrgHref("/cross-team-scrim", orgId),
        primary: true,
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Team calendar stays available while Scrims reload.",
        href: hubHref("/team", "calendar", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Scout coverage stays honest when this surface is down.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "team-data",
        label: "Open Team Data",
        detail: "TBA/team inventory stays independent of scrim invites.",
        href: withOrgHref("/team/data", orgId),
      },
    ];
  }

  if (input.shell === "empty" || inviteCount === 0) {
    return [
      {
        id: "propose",
        label: "Propose a scrim",
        detail: "Log a real partner team below — invites never invent DEMO partners.",
        href: "#cross-team-scrim-propose",
        primary: true,
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Pick a practice window before sending a date.",
        href: hubHref("/team", "calendar", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Decide what scout data you are willing to share.",
        href: hubHref("/competition", "scouting", orgId),
      },
      {
        id: "team-data",
        label: "Open Team Data",
        detail: "Confirm partner team numbers from real TBA context.",
        href: withOrgHref("/team/data", orgId),
      },
    ];
  }

  return [
    {
      id: "upcoming",
      label: upcomingCount > 0 ? "Review upcoming scrims" : "Scrim board ready",
      detail:
        upcomingCount > 0
          ? `${upcomingCount} upcoming invite${upcomingCount === 1 ? "" : "s"} — real partner rows only.`
          : "Invites and data-share agreements use logged rows only — never DEMO metrics.",
      href: "#cross-team-scrim-upcoming",
      primary: true,
    },
    {
      id: "calendar",
      label: "Open Calendar",
      detail: "Cross-check practice/event conflicts before confirming dates.",
      href: hubHref("/team", "calendar", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Align data-share scope with what your scouts actually collect.",
      href: hubHref("/competition", "scouting", orgId),
    },
    {
      id: "team-data",
      label: "Open Team Data",
      detail: "Verify partner team context from TBA — never invent DEMO numbers.",
      href: withOrgHref("/team/data", orgId),
    },
  ];
}
