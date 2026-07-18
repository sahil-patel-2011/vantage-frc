import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";

/** Soft-UI related surfaces for live ops / now-next My Day (never DEMO matches). */
export const MY_DAY_RELATED_LINKS = [
  { id: "command", label: "Event Day", kind: "hub" as const, tab: "command" },
  { id: "schedule", label: "Schedule", kind: "path" as const, path: "/schedule" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "match-checklist", label: "Match checklist", kind: "hub" as const, tab: "match-checklist" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
] as const;

export type MyDayRelatedId = (typeof MY_DAY_RELATED_LINKS)[number]["id"];

export type MyDayRelatedLink = {
  id: MyDayRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Event Day · Schedule · Strategy. */
export const MY_DAY_RELATED_INCLUDE: MyDayRelatedId[] = ["command", "schedule", "strategy"];

/**
 * Soft-UI cross-links from My Day → Event Day / Schedule / Strategy.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function myDayRelatedLinks(
  orgId?: string | null,
  options?: { active?: MyDayRelatedId; include?: MyDayRelatedId[] },
): MyDayRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return MY_DAY_RELATED_LINKS.filter((link) => {
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

export type MyDayShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type MyDayNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type MyDayEmptyCopy = {
  kind: MyDayShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO matches. */
export type MyDaySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function myDaySetupSteps(orgId?: string | null): MyDaySetupStep[] {
  return [
    {
      id: "workspace",
      label: "Select workspace",
      detail: "Choose your team organization — next-match timing is org-scoped.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull TBA schedule rows into Neon — never invent DEMO matches.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Confirm the active event the pit and My Day share.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Full event board stays blank until real TBA matches exist.",
      href: withOrgHref("/schedule", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Alliance prep uses the same event context — never DEMO callouts.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ];
}

/** Real match counts only — never invent DEMO totals. */
export function formatMyDayMatchCount(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** True when the event schedule has no rows for us yet — Soft-UI empty. */
export function isMyDayScheduleEmpty(input: {
  emptyReason?: "no_schedule" | "no_upcoming" | null;
  ourMatchCount?: number;
}): boolean {
  if (input.emptyReason === "no_schedule" || input.emptyReason === "no_upcoming") return true;
  return (input.ourMatchCount ?? 0) === 0;
}

/** Classify My Day Soft-UI shell — never invents DEMO matches. */
export function classifyMyDayShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  emptyReason?: "no_schedule" | "no_upcoming" | null;
  ourMatchCount?: number;
}): MyDayShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed && input.status == null) return "error";
  if (input.status === "setup_required") return "setup";
  if (input.status !== "ready") return "error";
  if (isMyDayScheduleEmpty(input)) return "empty";
  return "ready";
}

/** Soft-UI empty / setup / error copy — never DEMO matches. */
export function myDayShellCopy(
  kind: MyDayShellKind,
  options?: { emptyReason?: "no_schedule" | "no_upcoming" | null },
): MyDayEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading My Day…",
        description:
          "Checking workspace membership and your next match — never DEMO match times.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load My Day",
        description:
          "A network or server issue blocked next-match timing. Retry, or open Event Day / Schedule / Strategy while it reloads — never invent DEMO matches.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup required",
        title: "Select a team workspace",
        description:
          "My Day is org-scoped. Pick a workspace, set an active event, and sync TBA before a next match appears — nothing is pre-seeded.",
      };
    case "empty":
      if (options?.emptyReason === "no_upcoming") {
        return {
          kind,
          badge: "No upcoming matches",
          title: "Schedule is in — you are not on deck yet",
          description:
            "Your team is not assigned to remaining matches. Check back after alliances post — never DEMO placeholders. Cross-check Event Day, Schedule, and Strategy.",
        };
      }
      return {
        kind,
        badge: "No matches yet",
        title: "Waiting on the event schedule",
        description:
          "Matches appear after TBA reference sync for the active event — never DEMO times. Open Event Day, Schedule, or Strategy while sync catches up.",
      };
    default:
      return {
        kind,
        title: "My Day",
        description:
          "Next match, bumper color, partners, and opponents from real TBA rows — never DEMO matches.",
      };
  }
}

/**
 * Soft-UI next actions for My Day empty/setup shells.
 * Points at real Event Day / Schedule / Strategy paths — never DEMO matches.
 */
export function myDayNextActions(input: {
  orgId?: string | null;
  shell: MyDayShellKind;
  emptyReason?: "no_schedule" | "no_upcoming" | null;
  hasActiveEvent?: boolean;
}): MyDayNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    const needsEvent = Boolean(orgId) && input.hasActiveEvent === false;
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Select workspace",
          detail: "Next-match timing is org-scoped — pick a team before loading TBA rows.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "schedule",
          label: "Open Schedule",
          detail: "Full event boards stay blank until a workspace and TBA sync exist — never DEMO matches.",
          href: withOrgHref("/schedule", null),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Alliance prep lives on Strategy once event context is set.",
          href: hubHref("/competition", "strategy", null),
        },
      ];
    }
    if (needsEvent) {
      return [
        {
          id: "workspace",
          label: "Set active event",
          detail: "Workspace picks the TBA event key My Day reads — empty until you choose one.",
          href: withOrgHref("/workspace", orgId),
          primary: true,
        },
        {
          id: "command",
          label: "Open Event Day",
          detail: "Confirm the synced event context the pit uses for day-of ops.",
          href: hubHref("/competition", "command", orgId),
        },
        {
          id: "schedule",
          label: "Open Schedule",
          detail: "Event match rows stay blank until the active event is set and synced.",
          href: withOrgHref("/schedule", orgId),
        },
        {
          id: "strategy",
          label: "Open Strategy",
          detail: "Strategy shares the same active event once it is selected.",
          href: hubHref("/competition", "strategy", orgId),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Open Workspace",
        detail: "Finish membership or event setup so My Day can resolve your org.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Day-of command uses the same active event as next-match timing.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Full board and My Day share TBA match rows — never DEMO placeholders.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Prep callouts stay blank until real scout/TBA metrics exist.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry My Day",
        detail: "Reload real TBA next-match rows — nothing is pre-seeded while this fails.",
        href: withOrgHref("/my-day", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Pit command may still load from Competition if personal timing failed.",
        href: hubHref("/competition", "command", orgId),
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Full event board is the source for My Day countdowns.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Alliance prep stays available while next-match reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    const noUpcoming = input.emptyReason === "no_upcoming";
    return [
      {
        id: noUpcoming ? "schedule" : "command",
        label: noUpcoming ? "Open Schedule" : "Check Event Day sync",
        detail: noUpcoming
          ? "Confirm posted alliances on the full board — never DEMO match assignments."
          : "Matches appear after TBA reference sync for the active event — never DEMO placeholders.",
        href: noUpcoming
          ? withOrgHref("/schedule", orgId)
          : hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: noUpcoming ? "command" : "schedule",
        label: noUpcoming ? "Open Event Day" : "Open Schedule",
        detail: noUpcoming
          ? "Day-of queues share the same event once alliances post."
          : "Full event board stays blank until TBA rows land in Neon.",
        href: noUpcoming
          ? hubHref("/competition", "command", orgId)
          : withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Prep while waiting — Strategy never invents DEMO EPA or win rates.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "team-data",
        label: "Sync team data",
        detail: "Pull TBA schedules into Neon when the event is posted and still empty here.",
        href: withOrgHref("/team/data", orgId),
      },
    ].slice(0, 4);
  }

  return [
    {
      id: "command",
      label: "Open Event Day",
      detail: "Pit queues and readiness share this next-match context.",
      href: hubHref("/competition", "command", orgId),
      primary: true,
    },
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Countdowns and the full board use the same TBA schedule rows.",
      href: withOrgHref("/schedule", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Alliance prep for partners and opponents stays grounded in real data.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "match-checklist",
      label: "Open Match checklist",
      detail: "Timed pit checks for this match — progress only from real item taps.",
      href: hubHref("/competition", "match-checklist", orgId),
    },
  ].slice(0, 4);
}
