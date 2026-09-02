import { hubHref } from "../nav/hubs";
import type { TeamHubRelatedId } from "../team/team-related";
import {
  ATTENDANCE_KIND_LABELS,
  type AttendanceEvent,
  type AttendanceKind,
  type AttendanceMember,
} from "../attendance";

/** Focused Soft-UI Team strip when Attendance is open (never DEMO rates). */
export const ATTENDANCE_TEAM_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "practice",
  "calendar",
  "messages",
];

export type AttendanceListFilter = "all" | "unmarked" | "empty" | AttendanceKind;

export const ATTENDANCE_LIST_FILTERS: Array<{ id: AttendanceListFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "unmarked", label: "Needs marks" },
  { id: "empty", label: "Empty rolls" },
  { id: "practice", label: "Practice" },
  { id: "build", label: "Build" },
  { id: "meeting", label: "Meeting" },
  { id: "competition", label: "Competition" },
  { id: "outreach", label: "Outreach" },
  { id: "other", label: "Other" },
];

export type AttendanceNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/** Deep-link into Attendance for a real event — never invents attendance %. */
export function attendanceEventHref(
  orgId?: string | null,
  options?: { eventId?: string | null; occurredOn?: string | null; seasonYear?: number | null },
): string {
  const params = new URLSearchParams();
  params.set("tab", "attendance");
  if (orgId) params.set("orgId", orgId);
  if (options?.eventId) params.set("eventId", options.eventId);
  if (options?.occurredOn) params.set("occurredOn", options.occurredOn);
  if (options?.seasonYear != null) params.set("seasonYear", String(options.seasonYear));
  return `/team?${params.toString()}`;
}

/** Practice / Calendar Soft-UI cross-links with optional occurred_on handoff. */
export function attendancePracticeHref(orgId?: string | null): string {
  return hubHref("/team", "practice", orgId);
}

export function attendanceCalendarHref(orgId?: string | null): string {
  return hubHref("/team", "calendar", orgId);
}

/** Session evidence from real marks only — never DEMO % rates. */
export function formatEventEvidence(event: AttendanceEvent): string {
  const present = event.entries.length;
  if (present === 0) return "No one marked yet";
  const hours = event.entries.reduce((sum, entry) => {
    const h = entry.hours ?? event.creditHours;
    return Number.isFinite(h) && h > 0 ? sum + h : sum;
  }, 0);
  const parts = [`${present} present`];
  if (hours > 0) {
    const rounded = Math.round(hours * 100) / 100;
    parts.push(`${rounded}h credited`);
  }
  const mentors = event.entries.filter((e) => e.role === "mentor").length;
  if (mentors > 0) parts.push(`${mentors} mentor${mentors === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** Compact session-picker label — date + kind from real rows. */
export function formatSessionOption(
  event: Pick<AttendanceEvent, "title" | "occurredOn" | "kind">,
  fmtDate: (ymd: string) => string,
): string {
  const date = event.occurredOn ? fmtDate(event.occurredOn) : "";
  const kind = ATTENDANCE_KIND_LABELS[event.kind] ?? event.kind;
  if (date && kind) return `${event.title} · ${date} · ${kind}`;
  if (date) return `${event.title} · ${date}`;
  return event.title;
}

/** Members not yet on the roll — one-tap candidates from real memberships only. */
export function membersNotMarked(
  members: AttendanceMember[],
  event: AttendanceEvent | null | undefined,
): AttendanceMember[] {
  if (!event) return members;
  const markedUsers = new Set(event.entries.map((entry) => entry.userId).filter((id): id is string => Boolean(id)));
  const markedNames = new Set(event.entries.map((entry) => entry.personName.trim().toLowerCase()));
  return members.filter(
    (member) => !markedUsers.has(member.userId) && !markedNames.has(member.name.trim().toLowerCase()),
  );
}

/**
 * Filter real attendance_events only — never invents DEMO rolls or %.
 * "unmarked" = events with zero entries OR open roster slots when members are known.
 */
export function filterAttendanceEvents(
  events: AttendanceEvent[],
  filter: AttendanceListFilter,
  options?: { members?: AttendanceMember[]; query?: string },
): AttendanceEvent[] {
  const query = (options?.query ?? "").trim().toLowerCase();
  const members = options?.members ?? [];

  return events.filter((event) => {
    if (filter === "empty" && event.entries.length > 0) return false;
    if (filter === "unmarked") {
      if (event.entries.length === 0) {
        /* empty roll still needs marks */
      } else {
        const open = membersNotMarked(members, event);
        if (members.length === 0 || open.length === 0) return false;
      }
    }
    if (filter !== "all" && filter !== "unmarked" && filter !== "empty" && event.kind !== filter) {
      return false;
    }
    if (!query) return true;
    const hay = `${event.title} ${event.kind} ${event.occurredOn} ${event.entries.map((e) => e.personName).join(" ")}`.toLowerCase();
    return hay.includes(query);
  });
}

/** Prefer deep-link focus, else most recent event — never a fabricated session. */
export function pickDefaultSession(
  events: AttendanceEvent[],
  options?: { eventId?: string | null; occurredOn?: string | null; currentId?: string | null },
): string | null {
  if (!events.length) return null;
  if (options?.eventId && events.some((e) => e.id === options.eventId)) return options.eventId!;
  if (options?.occurredOn) {
    const byDate = events.find((e) => e.occurredOn === options.occurredOn);
    if (byDate) return byDate.id;
  }
  if (options?.currentId && events.some((e) => e.id === options.currentId)) return options.currentId!;
  return events[0]!.id;
}

/**
 * Soft-UI next actions for Attendance empty/setup/ready.
 * Points at Practice / Calendar — never DEMO attendance rates.
 */
export function attendanceNextActions(input: {
  orgId?: string | null;
  eventCount: number;
  emptyRollCount: number;
  canManage: boolean;
  selectedEventId?: string | null;
  selectedOccurredOn?: string | null;
}): AttendanceNextAction[] {
  const orgId = input.orgId ?? null;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Select workspace",
        detail: "Choose your team organization before logging who showed up.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: AttendanceNextAction[] = [];

  if (input.eventCount === 0) {
    actions.push({
      id: "first-roll",
      label: input.canManage ? "Create the first roll call" : "Ask an admin for a roll call",
      detail: input.canManage
        ? "Add a practice or meeting with an occurred_on date — the board stays empty until you mark people."
        : "Owners and admins create attendance events; presence stays blank until someone logs marks.",
      href: attendanceEventHref(orgId),
      primary: true,
    });
    actions.push({
      id: "calendar",
      label: "Schedule on Calendar",
      detail: "Quick-add a shop night — practices can open a linked roll call for that date.",
      href: attendanceCalendarHref(orgId),
    });
    actions.push({
      id: "practice",
      label: "Open Practice",
      detail: "Log drive sessions after the block — link roll calls by occurred_on, never by invented %.",
      href: attendancePracticeHref(orgId),
    });
    return actions;
  }

  if (input.emptyRollCount > 0) {
    actions.push({
      id: "mark-empty",
      label: `Mark ${input.emptyRollCount} empty roll${input.emptyRollCount === 1 ? "" : "s"}`,
      detail: "One-tap team members who showed up — totals use only names you add.",
      href: attendanceEventHref(orgId, {
        eventId: input.selectedEventId,
        occurredOn: input.selectedOccurredOn,
      }),
      primary: true,
    });
  }

  actions.push({
    id: "practice",
    label: "Log Practice reps",
    detail: "After roll call, time cycles on Practice — success rate stays blank until reps exist.",
    href: attendancePracticeHref(orgId),
    primary: actions.length === 0,
  });
  actions.push({
    id: "calendar",
    label: "Team calendar",
    detail: "Upcoming practices and build blocks live on Calendar & subteams.",
    href: attendanceCalendarHref(orgId),
  });
  actions.push({
    id: "messages",
    label: "Nudge in Messages",
    detail: "Ask who is marking presence when the roll is still empty.",
    href: hubHref("/team", "messages", orgId),
  });

  return actions.slice(0, 5);
}
