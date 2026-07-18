// Competition My Day — our matches from matches_ref for the active event.
// Framework-free so API, UI, ICS, and unit tests share the same helpers.

import {
  allianceOf,
  compLevelLabel,
  fmtMatchTime,
  isScored,
  nextOurMatch,
  ourMatches,
  stripFrc,
  type ScheduleMatch,
} from "./schedule-board";

export type MyDayContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
  eventKey: string | null;
  eventName: string | null;
};

export type MyDayMatchLinks = {
  command: string;
  briefing: string;
  checklist: string;
  schedule: string;
  scoutPartners: Array<{ teamKey: string; teamNumber: string; href: string }>;
  scoutOpponents: Array<{ teamKey: string; teamNumber: string; href: string }>;
};

export type MyDayMatch = {
  matchKey: string;
  compLevel: string;
  matchLabel: string;
  matchNumber: number;
  scheduledTime: string | null;
  timeLabel: string;
  alliance: "red" | "blue";
  bumperCue: string;
  partners: string[];
  opponents: string[];
  partnerKeys: string[];
  opponentKeys: string[];
  scored: boolean;
  redScore: number | null;
  blueScore: number | null;
  isNext: boolean;
  links: MyDayMatchLinks;
};

export type MyDayFreshness = {
  /** ISO timestamptz of max(matches_ref.synced_at) for the active event. */
  syncedAt: string | null;
  /** Short relative label for the strip, e.g. "Synced 12m ago". */
  label: string;
  matchCount: number;
  ourMatchCount: number;
};

export type MyDayLogisticsCue = {
  lodging: {
    hotelName: string;
    hotelAddress: string;
    hotelPhone: string;
    roomLabel: string;
    checkInAt: string | null;
    checkOutAt: string | null;
    tripTitle: string;
    tripId: string;
  } | null;
  nextTravel: {
    id: string;
    kind: string;
    title: string;
    startsAt: string;
    endsAt: string | null;
    location: string;
    meetingPoint: string;
    notes: string;
    tripId: string;
    tripTitle: string;
  } | null;
  onDuty: {
    id: string;
    tripId: string | null;
    mentorUserId: string | null;
    mentorName: string;
    phone: string;
    startsAt: string;
    endsAt: string | null;
    locationNote: string;
    notes: string;
  } | null;
  checklistPercent: number | null;
};

export type MyDayView =
  | {
      status: "ready";
      context: MyDayContext;
      teamKey: string;
      next: MyDayMatch | null;
      matches: MyDayMatch[];
      freshness: MyDayFreshness;
      logistics?: MyDayLogisticsCue;
      emptyReason: "no_schedule" | "no_upcoming" | null;
      links?: {
        command: string;
        schedule: string;
        logistics: string;
        scouting: string;
        checklist: string;
        calendar: string;
        knowledge: string;
        discord: string;
      };
    }
  | {
      status: "setup_required";
      context: MyDayContext;
      message: string;
      steps?: Array<{ id: string; label: string; detail: string; href: string }>;
    };

function withOrg(path: string, orgId: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ orgId, ...(extra ?? {}) });
  return `${path}?${params.toString()}`;
}

/** Stress-reducing bumper switch line for the alliance color. */
export function bumperCue(alliance: "red" | "blue" | null | undefined): string {
  if (alliance === "red") return "Switch to RED bumpers";
  if (alliance === "blue") return "Switch to BLUE bumpers";
  return "Alliance TBD - confirm bumpers before queue";
}

export function matchAlertTitle(match: Pick<MyDayMatch, "matchLabel">): string {
  return `Next match · ${match.matchLabel}`;
}

export function matchAlertBody(input: {
  eventName: string | null;
  match: Pick<MyDayMatch, "matchLabel" | "bumperCue" | "scheduledTime" | "alliance">;
  teamNumber: number | null;
}): string {
  const event = input.eventName?.trim() || "Your event";
  const team = input.teamNumber ? `Team ${input.teamNumber}` : "Your team";
  const when = formatMyDayWhen(input.match.scheduledTime);
  return [team, input.match.matchLabel, input.match.bumperCue, when, event].filter(Boolean).join(" · ");
}

export function formatMyDayWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Stable fingerprint of our schedule (times + alliances) for change detection. */
export function scheduleFingerprint(matches: ScheduleMatch[], teamKey: string): string {
  return ourMatches(matches, teamKey)
    .map((match) => {
      const side = allianceOf(match, teamKey) ?? "?";
      return [
        match.matchKey,
        match.scheduledTime ?? "",
        side,
        match.red.join(","),
        match.blue.join(","),
      ].join("|");
    })
    .join(";");
}

export function freshnessLabel(syncedAt: string | null, now = Date.now()): string {
  if (!syncedAt) return "Schedule not synced yet";
  const ms = now - new Date(syncedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "Schedule sync unknown";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "Synced just now";
  if (minutes < 60) return `Synced ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `Synced ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `Synced ${days}d ago`;
}

function teamLinks(
  orgId: string,
  matchKey: string,
  keys: string[],
  ourKey: string,
): Array<{ teamKey: string; teamNumber: string; href: string }> {
  return keys
    .filter((key) => key !== ourKey)
    .map((teamKey) => ({
      teamKey,
      teamNumber: stripFrc(teamKey),
      href: withOrg("/scouting", orgId, { teamKey, matchKey }),
    }));
}

export function buildMyDayMatch(
  match: ScheduleMatch,
  input: { orgId: string; teamKey: string; isNext: boolean },
): MyDayMatch | null {
  const alliance = allianceOf(match, input.teamKey);
  if (!alliance) return null;
  const partnerKeys = (alliance === "red" ? match.red : match.blue).filter((key) => key !== input.teamKey);
  const opponentKeys = alliance === "red" ? match.blue : match.red;
  const matchLabel = `${compLevelLabel(match.compLevel)} ${match.matchNumber}`;

  return {
    matchKey: match.matchKey,
    compLevel: match.compLevel,
    matchLabel,
    matchNumber: match.matchNumber,
    scheduledTime: match.scheduledTime,
    timeLabel: fmtMatchTime(match.scheduledTime) || "Time TBD",
    alliance,
    bumperCue: bumperCue(alliance),
    partners: partnerKeys.map(stripFrc),
    opponents: opponentKeys.map(stripFrc),
    partnerKeys,
    opponentKeys,
    scored: isScored(match),
    redScore: match.redScore,
    blueScore: match.blueScore,
    isNext: input.isNext,
    links: {
      command: withOrg("/command", input.orgId),
      briefing: withOrg("/briefing", input.orgId, { matchKey: match.matchKey }),
      checklist: withOrg("/match-checklist", input.orgId),
      schedule: withOrg("/schedule", input.orgId),
      scoutPartners: teamLinks(input.orgId, match.matchKey, partnerKeys, input.teamKey),
      scoutOpponents: teamLinks(input.orgId, match.matchKey, opponentKeys, input.teamKey),
    },
  };
}

export function buildMyDayMatches(
  matches: ScheduleMatch[],
  input: { orgId: string; teamKey: string },
): { next: MyDayMatch | null; matches: MyDayMatch[] } {
  const ours = ourMatches(matches, input.teamKey);
  const nextRaw = nextOurMatch(matches, input.teamKey);
  const nextKey = nextRaw?.matchKey ?? null;
  const built = ours
    .map((match) =>
      buildMyDayMatch(match, {
        orgId: input.orgId,
        teamKey: input.teamKey,
        isNext: match.matchKey === nextKey,
      }),
    )
    .filter((entry): entry is MyDayMatch => entry != null);
  return {
    next: built.find((entry) => entry.isNext) ?? null,
    matches: built,
  };
}

/** ICS / calendar card for one of our matches (15-minute field slot). */
export function myDayMatchToCalendarEvent(
  match: MyDayMatch,
  eventName: string | null,
): {
  id: string;
  title: string;
  kind: string;
  location: string;
  description: string;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  allDay: boolean;
} | null {
  if (!match.scheduledTime) return null;
  const start = new Date(match.scheduledTime);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + 15 * 60_000);
  const startsAt = start.toISOString();
  const endsAt = end.toISOString();
  const title = `${match.matchLabel} · ${match.alliance === "red" ? "RED" : "BLUE"} bumpers`;
  const description = [
    match.bumperCue,
    `With ${match.partners.length ? match.partners.join(", ") : "—"}`,
    `vs ${match.opponents.length ? match.opponents.join(", ") : "—"}`,
    eventName ? `Event: ${eventName}` : null,
    "Open My Day in Vantage for scout / Event Day links.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `match-${match.matchKey}`,
    title,
    kind: "event",
    location: eventName ?? "",
    description,
    startsAt,
    endsAt,
    updatedAt: startsAt,
    allDay: false,
  };
}
