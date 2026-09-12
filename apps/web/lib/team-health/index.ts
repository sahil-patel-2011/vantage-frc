// Pure, unit-testable helpers for Team Health. No I/O, no framework imports.
// Engagement is derived from attendance entries and closed hour logs only.

import type {
  TeamHealthAttendanceEvent,
  TeamHealthHourSession,
  TeamHealthMember,
  TeamHealthReadiness,
  TeamHealthSummary,
  TeamHealthTier,
  TeamHealthTrendPoint,
} from "./types";

export type { TeamHealthAttendanceEvent, TeamHealthHourSession, TeamHealthMember, TeamHealthReadiness, TeamHealthSummary, TeamHealthTier, TeamHealthTrendPoint };

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function personKey(userId: string | null | undefined, name: string): string {
  if (userId) return `user:${userId}`;
  return `name:${name.trim().toLowerCase()}`;
}

export function weekStartUtc(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const day = date.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + mondayOffset);
  return date.toISOString().slice(0, 10);
}

export function hoursBetween(clockIn: string, clockOut: string): number {
  const start = Date.parse(clockIn);
  const end = Date.parse(clockOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return round1((end - start) / 3_600_000);
}

export type AttendanceEntryInput = {
  eventId: string;
  userId: string | null;
  personName: string;
  hours: number | null;
};

export type RosterMemberInput = {
  userId: string;
  name: string;
};

export type TeamHealthInputs = {
  roster: RosterMemberInput[];
  events: Array<{
    id: string;
    title: string;
    kind: string;
    occurredOn: string;
    creditHours: number;
  }>;
  entries: AttendanceEntryInput[];
  sessions: Array<{
    id: string;
    userId: string;
    name: string;
    kind: string;
    clockIn: string;
    clockOut: string | null;
  }>;
};

function closedSessions(sessions: TeamHealthInputs["sessions"]): TeamHealthHourSession[] {
  const closed: TeamHealthHourSession[] = [];
  for (const session of sessions) {
    if (!session.clockOut) continue;
    const hours = hoursBetween(session.clockIn, session.clockOut);
    if (hours <= 0) continue;
    closed.push({
      id: session.id,
      userId: session.userId,
      name: session.name,
      kind: session.kind,
      clockIn: session.clockIn,
      clockOut: session.clockOut,
      hours,
    });
  }
  return closed;
}

/**
 * Aggregate real attendance entries + closed hour logs into an engagement summary.
 * Empty input yields an empty summary — never a fabricated morale or engagement score.
 */
export function summarizeTeamHealth(input: TeamHealthInputs): TeamHealthSummary {
  const closed = closedSessions(input.sessions);
  const eventsById = new Map(input.events.map((event) => [event.id, event]));
  const usableEntries = input.entries.filter((entry) => eventsById.has(entry.eventId) && entry.personName.trim());

  const memberMap = new Map<string, TeamHealthMember>();
  const ensureMember = (key: string, userId: string | null, name: string): TeamHealthMember => {
    const existing = memberMap.get(key);
    if (existing) {
      if (!existing.userId && userId) existing.userId = userId;
      if (existing.name === "Unknown member" && name.trim()) existing.name = name.trim();
      return existing;
    }
    const created: TeamHealthMember = {
      key,
      userId,
      name: name.trim() || "Unknown member",
      attendanceEvents: 0,
      attendanceHours: 0,
      hourSessions: 0,
      shopHours: 0,
    };
    memberMap.set(key, created);
    return created;
  };

  for (const member of input.roster) {
    ensureMember(personKey(member.userId, member.name), member.userId, member.name);
  }

  const attendeesByEvent = new Map<string, Set<string>>();
  const attendeeKeys = new Set<string>();
  let totalAttendanceHours = 0;

  for (const entry of usableEntries) {
    const event = eventsById.get(entry.eventId);
    if (!event) continue;
    const key = personKey(entry.userId, entry.personName);
    const member = ensureMember(key, entry.userId, entry.personName);
    const eventPeople = attendeesByEvent.get(entry.eventId) ?? new Set<string>();
    if (!eventPeople.has(key)) {
      eventPeople.add(key);
      attendeesByEvent.set(entry.eventId, eventPeople);
      member.attendanceEvents += 1;
    }
    attendeeKeys.add(key);
    const hours = entry.hours != null && Number.isFinite(entry.hours) && entry.hours > 0 ? entry.hours : event.creditHours;
    const credited = Number.isFinite(hours) && hours > 0 ? hours : 0;
    member.attendanceHours = round1(member.attendanceHours + credited);
    totalAttendanceHours += credited;
  }

  const hourLoggerKeys = new Set<string>();
  let totalShopHours = 0;
  for (const session of closed) {
    const key = personKey(session.userId, session.name);
    const member = ensureMember(key, session.userId, session.name);
    member.hourSessions += 1;
    member.shopHours = round1(member.shopHours + session.hours);
    hourLoggerKeys.add(key);
    totalShopHours += session.hours;
  }

  const hasLogs = usableEntries.length > 0 || closed.length > 0;
  const rosterSize = input.roster.length;
  const attendanceRate =
    hasLogs && rosterSize > 0 && usableEntries.length > 0 ? clamp01(attendeeKeys.size / rosterSize) : null;
  const hoursParticipation =
    hasLogs && rosterSize > 0 && closed.length > 0 ? clamp01(hourLoggerKeys.size / rosterSize) : null;
  const rates = [attendanceRate, hoursParticipation].filter((value): value is number => value != null);
  const engagementScore = hasLogs ? average(rates) : null;

  const weekMap = new Map<string, TeamHealthTrendPoint>();
  const touchWeek = (iso: string): TeamHealthTrendPoint => {
    const weekStart = weekStartUtc(iso);
    const existing = weekMap.get(weekStart);
    if (existing) return existing;
    const created: TeamHealthTrendPoint = {
      weekStart,
      attendanceEvents: 0,
      attendees: 0,
      hourSessions: 0,
      shopHours: 0,
    };
    weekMap.set(weekStart, created);
    return created;
  };

  for (const event of input.events) {
    const people = attendeesByEvent.get(event.id);
    if (!people || people.size === 0) continue;
    const week = touchWeek(event.occurredOn);
    week.attendanceEvents += 1;
    week.attendees += people.size;
  }
  for (const session of closed) {
    const week = touchWeek(session.clockIn);
    week.hourSessions += 1;
    week.shopHours = round1(week.shopHours + session.hours);
  }

  const members = [...memberMap.values()]
    .filter((member) => member.attendanceEvents > 0 || member.hourSessions > 0 || input.roster.some((r) => personKey(r.userId, r.name) === member.key))
    .sort((a, b) => b.shopHours + b.attendanceHours - (a.shopHours + a.attendanceHours) || a.name.localeCompare(b.name));

  const checkIns = hasLogs
    ? members.filter((member) => member.attendanceEvents === 0 && member.hourSessions === 0)
    : [];

  return {
    hasLogs,
    rosterSize,
    eventCount: input.events.length,
    entryCount: usableEntries.length,
    uniqueAttendees: attendeeKeys.size,
    hourSessionCount: closed.length,
    uniqueHourLoggers: hourLoggerKeys.size,
    totalAttendanceHours: round1(totalAttendanceHours),
    totalShopHours: round1(totalShopHours),
    attendanceRate,
    hoursParticipation,
    engagementScore,
    members,
    trend: [...weekMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
    checkIns,
  };
}

function tierFromScore(score: number): TeamHealthTier {
  if (score >= 0.7) return "thriving";
  if (score >= 0.4) return "steady";
  return "at_risk";
}

/** Readiness from logged attendance/hours only — no morale component. */
export function computeTeamHealthReadiness(summary: TeamHealthSummary): TeamHealthReadiness {
  const recommendations: string[] = [];
  if (!summary.hasLogs) {
    recommendations.push("Log attendance or clock shop hours before Team Health can show engagement.");
    return {
      score: null,
      tier: null,
      components: { attendance: null, hours: null },
      recommendations,
    };
  }

  if (summary.attendanceRate != null && summary.attendanceRate < 0.6) {
    recommendations.push("Attendance coverage is low — take roll call at the next meeting or build.");
  }
  if (summary.hoursParticipation != null && summary.hoursParticipation < 0.5) {
    recommendations.push("Few members have clocked hours — open the shop kiosk or My hours.");
  }
  if (summary.entryCount === 0 && summary.hourSessionCount > 0) {
    recommendations.push("Hours are logged but attendance is empty — take roll call so presence is counted.");
  }
  if (summary.hourSessionCount === 0 && summary.entryCount > 0) {
    recommendations.push("Attendance is logged but shop hours are empty — clock in so shop time is counted.");
  }
  if (summary.checkIns.length > 0) {
    recommendations.push(
      `${summary.checkIns.length} roster member(s) have no attendance or hours this season — check in.`,
    );
  }

  return {
    score: summary.engagementScore,
    tier: summary.engagementScore == null ? null : tierFromScore(summary.engagementScore),
    components: {
      attendance: summary.attendanceRate,
      hours: summary.hoursParticipation,
    },
    recommendations,
  };
}
