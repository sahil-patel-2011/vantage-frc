import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";

/** Soft-UI related surfaces for the Match Schedule board (never DEMO matches). */
export const SCHEDULE_RELATED_LINKS = [
  { id: "calendar", label: "Calendar", kind: "team" as const, tab: "calendar" },
  { id: "command", label: "Event Day", kind: "competition" as const, tab: "command" },
  { id: "my-day", label: "My Day", kind: "competition" as const, tab: "my-day" },
  { id: "scouting", label: "Scouting", kind: "path" as const, path: "/scouting" },
  { id: "workspace", label: "Your team", kind: "path" as const, path: "/workspace" },
] as const;

export type ScheduleRelatedId = (typeof SCHEDULE_RELATED_LINKS)[number]["id"];

export type ScheduleRelatedLink = {
  id: ScheduleRelatedId;
  label: string;
  href: string;
};

/** Focused Soft-UI strip — Calendar / Event Day / My Day first. */
export const SCHEDULE_RELATED_INCLUDE: ScheduleRelatedId[] = [
  "calendar",
  "command",
  "my-day",
  "scouting",
];

/** Cross-links for Schedule Soft-UI (never DEMO match rows). */
export function scheduleRelatedLinks(
  orgId?: string | null,
  options?: { active?: ScheduleRelatedId; include?: ScheduleRelatedId[] },
): ScheduleRelatedLink[] {
  const include = options?.include ? new Set(options.include) : null;
  return SCHEDULE_RELATED_LINKS.filter((link) => {
    if (link.id === options?.active) return false;
    if (include && !include.has(link.id)) return false;
    return true;
  }).map((link) => {
    if (link.kind === "competition") {
      return { id: link.id, label: link.label, href: hubHref("/competition", link.tab, orgId) };
    }
    if (link.kind === "team") {
      return { id: link.id, label: link.label, href: hubHref("/team", link.tab, orgId) };
    }
    return { id: link.id, label: link.label, href: withOrgHref(link.path, orgId) };
  });
}

export type ScheduleShellKind = "loading" | "error" | "setup" | "empty" | "ready";

export type ScheduleNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Soft-UI next actions for Match Schedule empty/setup shells.
 * Points at real Calendar / Event Day / My Day paths — never DEMO matches.
 */
export function scheduleNextActions(input: {
  orgId?: string | null;
  shell: ScheduleShellKind;
  hasActiveEvent?: boolean;
  matchCount?: number;
}): ScheduleNextAction[] {
  const orgId = input.orgId ?? null;
  const matchCount = input.matchCount ?? 0;

  if (!orgId || input.shell === "setup") {
    const needsEvent = Boolean(orgId) && input.hasActiveEvent === false;
    if (!orgId) {
      return [
        {
          id: "workspace",
          label: "Choose your team",
          detail: "Choose your team before loading official match rows.",
          href: "/workspace",
          primary: true,
        },
        {
          id: "calendar",
          label: "Open Calendar",
          detail: "Practice and shop nights live on Team Calendar.",
          href: hubHref("/team", "calendar", null),
        },
      ];
    }
    if (needsEvent) {
      return [
        {
          id: "workspace",
          label: "Set active event",
          detail: "Your team’s active event is what the match board reads — empty until you choose one.",
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
          id: "calendar",
          label: "Open Calendar",
          detail: "Team practices stay on Calendar while competition matches sync from the official schedule.",
          href: hubHref("/team", "calendar", orgId),
        },
      ];
    }
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Finish membership or event setup so the schedule API can resolve your org.",
        href: withOrgHref("/workspace", orgId),
        primary: true,
      },
      {
        id: "command",
        label: "Open Event Day",
        detail: "Day-of command uses the same active event as this board.",
        href: hubHref("/competition", "command", orgId),
      },
    ];
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry Schedule",
        detail: "Reload real official match rows.",
        href: withOrgHref("/schedule", orgId),
        primary: true,
      },
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal match timing may still load from Competition if the board fetch failed.",
        href: hubHref("/competition", "my-day", orgId),
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Practice blocks are separate from competition qual/playoff rows.",
        href: hubHref("/team", "calendar", orgId),
      },
    ];
  }

  if (input.shell === "empty" || matchCount === 0) {
    return [
      {
        id: "command",
        label: "Check Event Day sync",
        detail: "Matches appear after official schedule sync for the active event.",
        href: hubHref("/competition", "command", orgId),
        primary: true,
      },
      {
        id: "my-day",
        label: "Open My Day",
        detail: "Personal queue stays blank until real alliance assignments exist.",
        href: hubHref("/competition", "my-day", orgId),
      },
      {
        id: "calendar",
        label: "Open Calendar",
        detail: "Shop practices and travel stay on Team Calendar, not this match board.",
        href: hubHref("/team", "calendar", orgId),
      },
      {
        id: "team-data",
        label: "Sync team data",
        detail: "Pull the official match schedule when the event is posted.",
        href: withOrgHref("/team/data", orgId),
      },
    ].slice(0, 4);
  }

  return [
    {
      id: "my-day",
      label: "Open My Day",
      detail: "Countdowns and your next match use the same official schedule rows.",
      href: hubHref("/competition", "my-day", orgId),
      primary: true,
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Command center for pit ops tied to this event’s schedule.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "calendar",
      label: "Open Calendar",
      detail: "Team practices and non-match blocks live on Calendar & subteams.",
      href: hubHref("/team", "calendar", orgId),
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Scout coverage chips on this board come from real assignments.",
      href: withOrgHref("/scouting", orgId),
    },
  ].slice(0, 4);
}

/** Classify Schedule Soft-UI shell from API status — never invents DEMO matches. */
export function classifyScheduleShell(input: {
  loading: boolean;
  fetchFailed?: boolean;
  status?: "setup_required" | "ready" | null;
  matchCount?: number;
}): ScheduleShellKind {
  if (input.loading) return "loading";
  if (input.fetchFailed && input.status == null) return "error";
  if (input.status === "setup_required") return "setup";
  if (input.status !== "ready") return "error";
  if ((input.matchCount ?? 0) === 0) return "empty";
  return "ready";
}
