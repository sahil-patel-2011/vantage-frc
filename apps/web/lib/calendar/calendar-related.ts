import { hubHref } from "../nav/hubs";
import { withOrgHref } from "../nav/product-nav";
import type { TeamHubRelatedId } from "../team/team-related";

/** Focused Soft-UI Team strip when Calendar is open (never DEMO placeholders). */
export const CALENDAR_TEAM_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "practice",
  "attendance",
  "messages",
];

/** Extra Soft-UI cross-links outside the Team hub tab strip. */
export const CALENDAR_OPS_RELATED_LINKS = [
  { id: "logistics", label: "Logistics", path: "/logistics" },
] as const;

export type CalendarOpsRelatedId = (typeof CALENDAR_OPS_RELATED_LINKS)[number]["id"];

export type CalendarOpsRelatedLink = {
  id: CalendarOpsRelatedId;
  label: string;
  href: string;
};

export type CalendarNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/** Org-scoped Logistics (and similar) links for Calendar Soft-UI. */
export function calendarOpsRelatedLinks(
  orgId?: string | null,
  options?: { active?: CalendarOpsRelatedId },
): CalendarOpsRelatedLink[] {
  return CALENDAR_OPS_RELATED_LINKS.filter((link) => link.id !== options?.active).map((link) => ({
    id: link.id,
    label: link.label,
    href: withOrgHref(link.path, orgId),
  }));
}

/** Compact month-cell label: first title, or count-only when many / empty. */
export function monthEventPeek(titles: string[], limit = 3): { peeks: string[]; overflow: number } {
  const peeks = titles.slice(0, limit).map((title) => title.trim()).filter(Boolean);
  return { peeks, overflow: Math.max(0, titles.length - peeks.length) };
}

/** Soft count chip for month cells (e.g. "3") — never invents events. */
export function monthEventCountLabel(count: number): string | null {
  if (count <= 0) return null;
  return String(count);
}

/**
 * What a screen reader hears on a month cell.
 *
 * Events and tasks are counted separately because they are different things to
 * a person planning a week: three events is a busy day, three tasks due is a
 * deadline. Rolling them into one "6 items" hides which one it is. A day with
 * neither says so plainly rather than reading as a bare date.
 */
export function monthCellLabel(dayLabel: string, eventCount: number, taskCount: number): string {
  const counts = dayCountParts(eventCount, taskCount);
  return counts ? `${dayLabel}, ${counts}` : `${dayLabel}, nothing scheduled`;
}

/** The same counts as a heading suffix: " · 2 events, 1 task due". */
export function dayCountLabel(eventCount: number, taskCount: number): string {
  return ` · ${dayCountParts(eventCount, taskCount) ?? "none scheduled"}`;
}

function dayCountParts(eventCount: number, taskCount: number): string | null {
  const parts: string[] = [];
  if (eventCount > 0) parts.push(`${eventCount} event${eventCount === 1 ? "" : "s"}`);
  if (taskCount > 0) parts.push(`${taskCount} task${taskCount === 1 ? "" : "s"} due`);
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * Readable Soft-UI next actions for Team Calendar / subteams.
 * Driven only by real subteam + event counts — never DEMO events.
 */
export function calendarNextActions(input: {
  orgId?: string | null;
  subteamCount: number;
  eventCount: number;
  canManage: boolean;
}): CalendarNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before scheduling practices or build sessions.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: CalendarNextAction[] = [];

  if (input.subteamCount === 0) {
    actions.push({
      id: "first-subteam",
      label: input.canManage ? "Create your first subteam" : "Ask an admin for subteams",
      detail: input.canManage
        ? "Mechanical, Programming, Business, Drive — groups make Combined vs subteam filters useful."
        : "Owners and admins create subteams; your calendar stays empty until they do.",
      href: hubHref("/team", "calendar", orgId),
      primary: true,
    });
    actions.push({
      id: "practice",
      label: "Open Practice",
      detail: "Log driver cycles after a real shop night — Practice never invents DEMO reps.",
      href: hubHref("/team", "practice", orgId),
    });
    actions.push({
      id: "messages",
      label: "Message the team",
      detail: "Coordinate who should create subteams in Messages.",
      href: hubHref("/team", "messages", orgId),
    });
    return actions.slice(0, 4);
  }

  if (input.eventCount === 0) {
    actions.push({
      id: "first-event",
      label: "Schedule the first practice",
      detail: "Quick-add a shop night on this calendar — nothing is seeded for you.",
      href: hubHref("/team", "calendar", orgId),
      primary: true,
    });
    actions.push({
      id: "attendance",
      label: "Prep Attendance roll call",
      detail: "Create an occurred_on roll call, or let Quick add open one for practices.",
      href: hubHref("/team", "attendance", orgId),
    });
    actions.push({
      id: "practice",
      label: "Practice Planner",
      detail: "After the session, log real cycle times — blank until someone times a rep.",
      href: hubHref("/team", "practice", orgId),
    });
    actions.push({
      id: "logistics",
      label: "Event logistics",
      detail: "Hotels and travel legs stay on Logistics until mentors add them.",
      href: withOrgHref("/logistics", orgId),
    });
    return actions.slice(0, 5);
  }

  actions.push({
    id: "practice",
    label: "Log practice after the block",
    detail: "Open Practice when a calendar practice ends — link roll call with occurred_on.",
    href: hubHref("/team", "practice", orgId),
    primary: true,
  });
  actions.push({
    id: "attendance",
    label: "Mark Attendance",
    detail: "Who showed up uses real attendance events — never DEMO percent.",
    href: hubHref("/team", "attendance", orgId),
  });
  actions.push({
    id: "logistics",
    label: "Travel & hotels",
    detail: "Trip legs on My trip come from Logistics — empty until added.",
    href: withOrgHref("/logistics", orgId),
  });
  actions.push({
    id: "messages",
    label: "Discuss in Messages",
    detail: "Announce schedule changes or ask who can cover a shift.",
    href: hubHref("/team", "messages", orgId),
  });

  return actions.slice(0, 5);
}
