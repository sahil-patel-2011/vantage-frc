import { hubHref } from "../nav/hubs";
import { setupActionsFrom } from "../setup-actions";
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

function eventDayRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    eventDayRelatedLinks(orgId, { include: [...EVENT_DAY_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = eventDayRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function dropEventDayRelatedDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  return dropRelatedStripDuplicates(orgId, items);
}

/** Soft-UI setup steps — hubHref / withOrgHref only; never DEMO schedule. */
export type EventDaySetupStep = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export function eventDaySetupSteps(orgId?: string | null): EventDaySetupStep[] {
  return dropRelatedStripDuplicates(orgId, [
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
  ]);
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

/** Empty-card title. A missing team is not "No event linked". */
export function eventDayEmptyTitle(input: {
  shell: EventDayShellKind;
  orgId?: string | null;
  hasActiveEvent?: boolean;
}): string {
  if (!input.orgId && (input.shell === "setup" || input.shell === "empty")) {
    return "Choose your team";
  }
  if (input.shell === "setup" && !input.hasActiveEvent) {
    return "No event linked";
  }
  return eventDayShellCopy(input.shell).title;
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
    case "ready":
      return {
        kind,
        title: "Command",
        description: "Next match, scout gaps, and briefs.",
      };
    default: {
      const _never: never = kind;
      return _never;
    }
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
    return setupActionsFrom(eventDaySetupSteps(orgId));
  }
  return dropRelatedStripDuplicates(orgId, eventDayShellNextActionCandidates(input));
}

function eventDayShellNextActionCandidates(input: {
  orgId?: string | null;
  shell: EventDayShellKind;
  hasActiveEvent?: boolean;
}): EventDayShellNextAction[] {
  const orgId = input.orgId ?? null;

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
        label: "Check schedule sync",
        detail: "Confirm TBA rows on the full board.",
        href: withOrgHref("/schedule", orgId),
        primary: true,
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
      id: "scouting",
      label: "Open Scouting",
      detail: "Close coverage gaps for upcoming alliances from the scout queue.",
      href: hubHref("/competition", "scouting", orgId),
      primary: true,
    },
  ];
}
