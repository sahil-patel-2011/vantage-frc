import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for Event Day Command (never DEMO schedule). */
export const EVENT_DAY_RELATED_LINKS = [
  { id: "my-day", label: "My Day", kind: "hub" as const, tab: "my-day" },
  { id: "schedule", label: "Schedule", kind: "path" as const, path: "/schedule" },
  { id: "strategy", label: "Strategy", kind: "hub" as const, tab: "strategy" },
  { id: "scouting", label: "Scouting", kind: "hub" as const, tab: "scouting" },
  { id: "logistics", label: "Logistics", kind: "path" as const, path: "/logistics" },
  { id: "match-checklist", label: "Match checklist", kind: "hub" as const, tab: "match-checklist" },
  { id: "team-data", label: "Team Data", kind: "path" as const, path: "/team/data" },
] as const;

export type EventDayRelatedId = (typeof EVENT_DAY_RELATED_LINKS)[number]["id"];

export type EventDayRelatedLink = {
  id: EventDayRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — My Day · Schedule · Strategy · Logistics. */
export const EVENT_DAY_RELATED_INCLUDE: EventDayRelatedId[] = [
  "my-day",
  "schedule",
  "strategy",
  "logistics",
];

/**
 * Soft-UI cross-links from Event Day → My Day / Schedule / Strategy / Scouting.
 * Build with hubHref / withOrgHref — never broken JSX href templates.
 */
export function eventDayRelatedLinks(
  orgId?: string | null,
  options?: { active?: EventDayRelatedId; include?: EventDayRelatedId[] },
): EventDayRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return EVENT_DAY_RELATED_LINKS.filter((link) => {
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

export type EventDayShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type EventDayShellNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

export type EventDayEmptyCopy = {
  kind: EventDayShellKind;
  badge?: string;
  title: string;
  description: string;
};

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO schedule. */
export type EventDaySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function eventDaySetupSteps(orgId?: string | null): EventDaySetupStep[] {
  return [
    {
      id: "workspace",
      label: "Choose your team",
      detail: "Choose your team to open Event Day Command.",
      href: orgId ? withOrgHref("/workspace", orgId) : "/workspace",
    },
    {
      id: "team-data",
      label: "Sync Team Data",
      detail: "Pull the match schedule from The Blue Alliance.",
      href: withOrgHref("/team/data", orgId),
    },
    {
      id: "my-day",
      label: "Open My Day",
      detail: "Personal next-match glance shares this event context.",
      href: hubHref("/competition", "my-day", orgId),
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
      detail: "Alliance prep uses the same event.",
      href: hubHref("/competition", "strategy", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Coverage queues stay empty until real partners/opponents post.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}

/** Real match counts only. */
export function formatEventDayMatchCount(value: unknown, loaded: boolean): string {
  if (!loaded) return "…";
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.floor(n).toLocaleString();
}

/** True when Event Day has no upcoming matches yet — Soft-UI empty. */
export function isEventDayScheduleEmpty(input: {
  status?: "live" | "setup_required" | "empty" | null;
  matchCount?: number;
}): boolean {
  if (input.status === "empty") return true;
  if (input.status === "live") return false;
  return (input.matchCount ?? 0) === 0;
}

/** Classify Event Day Soft-UI shell. */
export function classifyEventDayShell(input: {
  loading?: boolean;
  fetchFailed?: boolean;
  orgId?: string | null;
  status?: "live" | "setup_required" | "empty" | null;
  matchCount?: number;
  eventKey?: string | null;
}): EventDayShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed && input.status == null) return "error";
  if (!input.orgId) return "setup";
  if (input.status === "setup_required" || !input.eventKey) return "setup";
  if (input.status === "live") return "ready";
  if (isEventDayScheduleEmpty({ status: input.status, matchCount: input.matchCount })) {
    return "empty";
  }
  return "ready";
}

/** Soft-UI empty / setup / error copy. */
export function eventDayShellCopy(kind: EventDayShellKind): EventDayEmptyCopy {
  switch (kind) {
    case "loading":
      return {
        kind,
        title: "Loading…",
        description: "Checking your event schedule.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load Command",
        description: "Retry, or open Schedule while this reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Setup",
        title: "Set an active event",
        description: "Connect TBA and pick the event Command should follow.",
      };
    case "empty":
      return {
        kind,
        badge: "No matches",
        title: "No upcoming matches",
        description: "Matches appear after TBA sync for this event.",
      };
    default:
      return {
        kind,
        title: "Command",
        description: "Next match, scout gaps, and briefs.",
      };
  }
}

/**
 * Soft-UI next actions for Event Day empty/setup shells.
 * Points at real My Day / Schedule / Strategy / Scouting paths.
 */
export function eventDayShellNextActions(input: {
  orgId?: string | null;
  shell: EventDayShellKind;
  hasActiveEvent?: boolean;
}): EventDayShellNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId || input.shell === "setup") {
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Pick a team first.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "my-day",
          label: "Open My Day",
          detail: "Personal next-match glance stays blank until a team exists.",
          href: hubHref("/competition", "my-day", null),
        },
        {
          id: "schedule",
          label: "Open Schedule",
          detail: "Full event boards stay blank until a team and TBA sync exist.",
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
    if (input.hasActiveEvent === false) {
      return [
        {
          id: "event",
          label: "Set active event",
          detail: "Owners/admins set the event Command reads.",
          href: withOrgHref("/command", orgId),
          primary: true,
        },
        {
          id: "my-day",
          label: "Open My Day",
          detail: "Personal timing shares the same active event once it is set.",
          href: hubHref("/competition", "my-day", orgId),
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
        {
          id: "scouting",
          label: "Open Scouting",
          detail: "Coverage queues need the same event context.",
          href: hubHref("/competition", "scouting", orgId),
        },
      ].slice(0, 4);
    }
    return [
      {
        id: "team-data",
        label: "Sync Team Data",
        detail: "Pull the match schedule from The Blue Alliance.",
        href: withOrgHref("/team/data", orgId),
        primary: true,
      },
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal next-match glance uses the same event context.",
        href: hubHref("/competition", "my-day", orgId),
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Full board and Command share TBA match rows.",
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
        label: "Retry Event Day",
        detail: "Reload real TBA schedule rows.",
        href: withOrgHref("/command", orgId),
        primary: true,
      },
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal timing may still load if the command board failed.",
        href: hubHref("/competition", "my-day", orgId),
      },
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Full event board is the source for now/next queues.",
        href: withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Alliance prep stays available while Command reloads.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ];
  }

  if (input.shell === "empty") {
    return [
      {
        id: "schedule",
        label: "Open Schedule",
        detail: "Confirm TBA rows on the full board.",
        href: withOrgHref("/schedule", orgId),
        primary: true,
      },
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal next-match glance stays blank until your team is on the schedule.",
        href: hubHref("/competition", "my-day", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Prep while waiting — Strategy stays blank without metrics.",
        href: hubHref("/competition", "strategy", orgId),
      },
      {
        id: "scouting",
        label: "Open Scouting",
        detail: "Coverage queues build from real upcoming alliances only.",
        href: hubHref("/competition", "scouting", orgId),
      },
    ];
  }

  return [
    {
      id: "my-day",
      label: "Open My Day",
      detail: "Personal bumper cue and travel strip for this next match.",
      href: hubHref("/competition", "my-day", orgId),
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
      id: "scouting",
      label: "Open Scouting",
      detail: "Close coverage gaps for upcoming alliances from the scout queue.",
      href: hubHref("/competition", "scouting", orgId),
    },
  ];
}
