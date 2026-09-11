import { hubHref } from "./nav/hubs";
import { withOrgHref } from "./nav/product-nav";
import { setupActionsFrom } from "./setup-actions";

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

function myDayRelatedHrefs(orgId?: string | null): Set<string> {
  return new Set(
    myDayRelatedLinks(orgId, { include: [...MY_DAY_RELATED_INCLUDE] }).map((link) => link.href),
  );
}

function dropRelatedStripDuplicates<T extends { href: string }>(
  orgId: string | null | undefined,
  items: T[],
): T[] {
  const related = myDayRelatedHrefs(orgId);
  return items.filter((item) => !related.has(item.href));
}

export function myDaySetupSteps(orgId?: string | null): MyDaySetupStep[] {
  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team to open next-match timing.",
        href: "/workspace",
      },
    ];
  }
  return [
    {
      id: "command",
      label: "Set the event you’re at",
      detail: "Event Day picks the event so next-match times can show.",
      href: hubHref("/competition", "command", orgId),
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
        description: "Checking your team and next match.",
      };
    case "error":
      return {
        kind,
        badge: "Unavailable",
        title: "Could not load My Day",
        description: "Could not load My Day. Retry, or open Event Day while it reloads.",
      };
    case "setup":
      return {
        kind,
        badge: "Needs setup",
        title: "Choose your team",
        description:
          "Choose your team and set the event you’re at before a next match appears.",
      };
    case "empty":
      if (options?.emptyReason === "no_upcoming") {
        return {
          kind,
          badge: "No upcoming matches",
          title: "Schedule is in — you are not on deck yet",
          description:
            "Your team is not on remaining matches. Check back after alliances post.",
        };
      }
      return {
        kind,
        badge: "No matches yet",
        title: "Waiting on the event schedule",
        description: "Matches appear after the event schedule is set.",
      };
    default:
      return {
        kind,
        title: "My Day",
        description: "Next match, bumper color, partners, and opponents.",
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
    return setupActionsFrom(myDaySetupSteps(orgId));
  }

  if (input.shell === "error") {
    return [
      {
        id: "retry",
        label: "Retry My Day",
        detail: "Reload your next match.",
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
          ? "Confirm posted alliances on Event Day."
          : "Matches appear after the event schedule is set.",
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
          : "The event board stays blank until the schedule is saved.",
        href: noUpcoming
          ? hubHref("/competition", "command", orgId)
          : withOrgHref("/schedule", orgId),
      },
      {
        id: "strategy",
        label: "Open Strategy",
        detail: "Prep alliance notes while you wait.",
        href: hubHref("/competition", "strategy", orgId),
      },
    ].slice(0, 4);
  }

  return [
    {
      id: "scouting",
      label: "Scout this match",
      detail: "Fill the match form for partners and opponents.",
      href: hubHref("/competition", "scouting", orgId),
      primary: true,
    },
    {
      id: "command",
      label: "Open Event Day",
      detail: "Pit queues and readiness share this next-match context.",
      href: hubHref("/competition", "command", orgId),
    },
    {
      id: "schedule",
      label: "Open Schedule",
      detail: "Countdowns and the full board use the same event matches.",
      href: withOrgHref("/schedule", orgId),
    },
    {
      id: "strategy",
      label: "Open Strategy",
      detail: "Alliance prep for partners and opponents stays grounded in real data.",
      href: hubHref("/competition", "strategy", orgId),
    },
  ].slice(0, 4);
}
