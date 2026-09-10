import { hubHref } from "../nav/hubs";
import type { TeamHubRelatedId } from "../team/team-related";
import { sessionStats, type DriverSession, type LinkableAttendance } from "../driver-practice";

/** Focused Soft-UI Team strip when Practice is open (never DEMO placeholders). */
export const PRACTICE_TEAM_RELATED_INCLUDE: TeamHubRelatedId[] = [
  "calendar",
  "attendance",
  "batteries",
  "messages",
];

export type PracticeNextAction = {
  id: string;
  label: string;
  detail: string;
  href: string;
  primary?: boolean;
};

/**
 * Deep-link into Attendance for a linked roll call.
 * Uses real attendance_events.id and occurred_on — never invents attendance %.
 */
export function attendanceRollCallHref(
  orgId?: string | null,
  options?: { eventId?: string | null; occurredOn?: string | null },
): string {
  const params = new URLSearchParams();
  params.set("tab", "attendance");
  if (orgId) params.set("orgId", orgId);
  if (options?.eventId) params.set("eventId", options.eventId);
  if (options?.occurredOn) params.set("occurredOn", options.occurredOn);
  return `/team?${params.toString()}`;
}

/** Option label for attendance pickers — date from occurred_on only. */
export function formatAttendanceOption(
  event: Pick<LinkableAttendance, "title" | "occurredOn" | "kind">,
  fmtDate: (ymd: string) => string,
): string {
  const date = event.occurredOn ? fmtDate(event.occurredOn) : "";
  const kind = event.kind ? event.kind : "";
  if (date && kind) return `${event.title} · ${date} · ${kind}`;
  if (date) return `${event.title} · ${date}`;
  return event.title;
}

/**
 * Session list subtitle from logged cycles only.
 * Omits missing reps / success — never invents DEMO attendance %.
 */
export function formatSessionEvidence(session: Pick<DriverSession, "cycles" | "goal" | "attendanceEventTitle" | "buildTaskTitle">): string {
  const stats = sessionStats(session.cycles);
  const parts: string[] = [];
  if (stats.reps > 0) {
    parts.push(`${stats.reps} rep${stats.reps === 1 ? "" : "s"}`);
    if (stats.avgSeconds != null) {
      const avg = stats.avgSeconds % 1 === 0 ? String(stats.avgSeconds) : stats.avgSeconds.toFixed(2);
      parts.push(`${avg}s avg`);
    }
    if (stats.successRate != null) parts.push(`${stats.successRate}% made`);
  } else {
    parts.push("No reps logged yet");
  }
  if (session.goal.trim()) parts.push("Has goal");
  if (session.attendanceEventTitle) parts.push("Roll call linked");
  if (session.buildTaskTitle) parts.push("Task linked");
  return parts.join(" · ");
}

/**
 * Readable Soft-UI next actions for Practice schedules.
 * Points at real sessions / roll calls / calendar — never DEMO attendance %.
 */
export function practiceNextActions(input: {
  orgId?: string | null;
  sessions: DriverSession[];
  attendanceEventCount: number;
}): PracticeNextAction[] {
  const orgId = input.orgId ?? null;
  const sessions = input.sessions;

  if (!orgId) {
    return [
      {
        id: "workspace",
        label: "Choose your team",
        detail: "Choose your team before scheduling practice.",
        href: "/workspace",
        primary: true,
      },
    ];
  }

  const actions: PracticeNextAction[] = [];

  if (sessions.length === 0) {
    actions.push({
      id: "first-session",
      label: "Start your first session",
      detail: "Add a goal for the day, then log scoring reps — success rate stays blank until reps exist.",
      href: hubHref("/team", "practice", orgId),
      primary: true,
    });
    actions.push({
      id: "calendar",
      label: "Block practice on Calendar",
      detail: "Schedule field time with the team calendar, then open a matching Practice session.",
      href: hubHref("/team", "calendar", orgId),
    });
    actions.push({
      id: "attendance",
      label: "Create a roll call",
      detail: "Attendance events use occurred_on dates — link them after the session exists.",
      href: hubHref("/team", "attendance", orgId),
    });
    return actions;
  }

  const withoutGoal = sessions.filter((s) => !s.goal.trim());
  if (withoutGoal.length > 0) {
    actions.push({
      id: "add-goal",
      label: `Add a session goal${withoutGoal.length > 1 ? ` (${withoutGoal.length})` : ""}`,
      detail: `${withoutGoal[0]!.title} has no goal yet — write what the drive team should improve.`,
      href: hubHref("/team", "practice", orgId),
      primary: true,
    });
  }

  const withoutReps = sessions.filter((s) => s.cycles.length === 0);
  if (withoutReps.length > 0 && actions.length < 3) {
    actions.push({
      id: "log-reps",
      label: `Log reps for ${withoutReps[0]!.title}`,
      detail: "Cycle times and make/miss stay empty until someone times a rep.",
      href: hubHref("/team", "practice", orgId),
      primary: actions.length === 0,
    });
  }

  const unlinked = sessions.filter((s) => !s.attendanceEventId);
  if (unlinked.length > 0 && input.attendanceEventCount > 0 && actions.length < 3) {
    const sample = unlinked[0]!;
    actions.push({
      id: "link-roll",
      label: "Link attendance roll call",
      detail: `Connect ${sample.title} to who showed up — links use real occurred_on dates, never attendance %.`,
      href: hubHref("/team", "practice", orgId),
      primary: actions.length === 0,
    });
  }

  if (input.attendanceEventCount === 0 && actions.length < 3) {
    actions.push({
      id: "make-roll",
      label: "Open Attendance",
      detail: "Create a practice roll call with an occurred_on date, then link it from a session.",
      href: hubHref("/team", "attendance", orgId),
      primary: actions.length === 0,
    });
  }

  const linked = sessions.find((s) => s.attendanceEventId);
  if (linked?.attendanceEventId && actions.length < 4) {
    actions.push({
      id: "open-roll",
      label: "Open linked roll call",
      detail: linked.attendanceOccurredOn
        ? `Mark who was present on ${linked.attendanceOccurredOn}.`
        : "Mark who was present for the linked attendance event.",
      href: attendanceRollCallHref(orgId, {
        eventId: linked.attendanceEventId,
        occurredOn: linked.attendanceOccurredOn,
      }),
    });
  }

  actions.push({
    id: "batteries",
    label: "Batteries for practice",
    detail: "Log practice discharge and resistance from the same pack ops as pit.",
    href: hubHref("/team", "batteries", orgId),
    primary: actions.length === 0,
  });

  actions.push({
    id: "calendar",
    label: "Team calendar",
    detail: "Upcoming practice blocks live on Calendar & subteams.",
    href: hubHref("/team", "calendar", orgId),
  });

  return actions.slice(0, 5);
}
