/**
 * Shaping TBA Firehose payloads into the text a human reads on a phone at an event.
 *
 * Pure functions only — no DB, no env, no clock except the `now` you pass in — so the
 * wording is unit-testable and the webhook handler stays inside TBA's 10-second budget.
 *
 * Message types we act on (TBA sends more; the rest are recorded and ignored):
 *   upcoming_match     — ~10-20 min before a match is queued. The scout ping.
 *   match_score        — results posted.
 *   schedule_updated   — the event schedule moved.
 *   alliance_selection — alliances are set.
 *   verification       — one-time handshake carrying a code to paste into TBA.
 *   ping               — "is this endpoint alive" test from the TBA UI.
 */

export type TbaEnvelope = {
  messageType: string;
  messageData: Record<string, unknown>;
};

/** Accept the exact TBA shape and nothing else; a malformed body is a 400, not a guess. */
export function parseTbaEnvelope(raw: unknown): TbaEnvelope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const messageType = typeof record.message_type === "string" ? record.message_type.trim() : "";
  if (!messageType) return null;
  const data = record.message_data;
  const messageData =
    data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  return { messageType, messageData };
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(data: Record<string, unknown>, key: string): number | null {
  const value = data[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function readStringArray(data: Record<string, unknown>, key: string): string[] {
  const value = data[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/** `2024mil_qm42` → `2024mil`. Returns null when the key is not a match key. */
export function eventKeyFromMatchKey(matchKey: string | null | undefined): string | null {
  if (!matchKey) return null;
  const [eventKey] = matchKey.split("_");
  return eventKey && /^\d{4}[a-z0-9]+$/i.test(eventKey) ? eventKey : null;
}

/** The event this message is about, preferring the explicit field and falling back to the match key. */
export function eventKeyForMessage(envelope: TbaEnvelope): string | null {
  const explicit = readString(envelope.messageData, "event_key");
  if (explicit) return explicit;
  const nested = envelope.messageData.match;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const fromNested = readString(nested as Record<string, unknown>, "event_key");
    if (fromNested) return fromNested;
  }
  return eventKeyFromMatchKey(matchKeyForMessage(envelope));
}

/** `match_key` is sometimes top-level and sometimes only inside the embedded match model. */
export function matchKeyForMessage(envelope: TbaEnvelope): string | null {
  const direct = readString(envelope.messageData, "match_key");
  if (direct) return direct;
  const nested = envelope.messageData.match;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return readString(nested as Record<string, unknown>, "key");
  }
  return null;
}

const COMP_LEVEL_LABEL: Record<string, string> = {
  qm: "Qual",
  ef: "Eighthfinal",
  qf: "Quarterfinal",
  sf: "Semifinal",
  f: "Final",
};

/** `2024mil_qm42` → `Qual 42`; `2024mil_sf2m1` → `Semifinal 2 Match 1`. */
export function describeMatchKey(matchKey: string | null | undefined): string {
  if (!matchKey) return "Match";
  const suffix = matchKey.includes("_") ? matchKey.split("_").slice(1).join("_") : matchKey;
  const qual = /^qm(\d+)$/i.exec(suffix);
  if (qual) return `Qual ${Number(qual[1])}`;
  const bracket = /^(ef|qf|sf|f)(\d+)m(\d+)$/i.exec(suffix);
  if (bracket) {
    const level = bracket[1] ?? "";
    const label = COMP_LEVEL_LABEL[level.toLowerCase()] ?? level.toUpperCase();
    const set = Number(bracket[2]);
    const match = Number(bracket[3]);
    if (label === "Final") return `Final ${match}`;
    return `${label} ${set} Match ${match}`;
  }
  return suffix.toUpperCase();
}

/** `frc254` → `254`; anything else is passed through untouched. */
export function teamNumberLabel(teamKey: string): string {
  const match = /^frc(\d+[A-Z]?)$/i.exec(teamKey.trim());
  return match?.[1] ?? teamKey.trim();
}

export function teamKeyForNumber(teamNumber: number): string {
  return `frc${teamNumber}`;
}

/**
 * Whole minutes until `scheduledSeconds` (unix). Negative when the match is already
 * due. Returns null when TBA omitted a time — we then say "soon" instead of inventing
 * a countdown.
 */
export function minutesUntil(scheduledSeconds: number | null, now: Date): number | null {
  if (scheduledSeconds == null) return null;
  return Math.round((scheduledSeconds * 1000 - now.getTime()) / 60000);
}

export function countdownPhrase(minutes: number | null): string {
  if (minutes == null) return "coming up";
  if (minutes <= 0) return "now";
  if (minutes === 1) return "in 1 minute";
  if (minutes < 60) return `in ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "in about an hour" : `in about ${hours} hours`;
}

export type NotificationContent = {
  title: string;
  body: string;
  url: string;
  tag: string;
  urgent: boolean;
};

export type UpcomingMatchMessage = {
  eventKey: string | null;
  eventName: string | null;
  matchKey: string | null;
  teamKeys: string[];
  scheduledSeconds: number | null;
};

export function readUpcomingMatch(envelope: TbaEnvelope): UpcomingMatchMessage {
  return {
    eventKey: eventKeyForMessage(envelope),
    eventName: readString(envelope.messageData, "event_name"),
    matchKey: matchKeyForMessage(envelope),
    teamKeys: readStringArray(envelope.messageData, "team_keys"),
    scheduledSeconds:
      readNumber(envelope.messageData, "scheduled_time") ??
      readNumber(envelope.messageData, "predicted_time"),
  };
}

/**
 * The scout ping. `teamKeys` for the scout's assignment are listed so they know which
 * robot to watch without opening the app first.
 */
export function upcomingMatchNotificationForScout(input: {
  message: UpcomingMatchMessage;
  assignedTeamKeys: string[];
  now: Date;
}): NotificationContent {
  const label = describeMatchKey(input.message.matchKey);
  const minutes = minutesUntil(input.message.scheduledSeconds, input.now);
  const teams = input.assignedTeamKeys.map(teamNumberLabel).filter(Boolean);
  const who =
    teams.length === 0
      ? "You are scouting this match"
      : teams.length === 1
        ? `You have ${teams[0]}`
        : `You have ${teams.join(", ")}`;
  return {
    title: `${label} ${countdownPhrase(minutes)}`,
    body: `${who}. Head to your station.`,
    url: "/scouting",
    tag: `upcoming:${input.message.matchKey ?? input.message.eventKey ?? "match"}`,
    urgent: minutes == null || minutes <= 15,
  };
}

/** The same match, for the drive team / leads when the org's own robot is on the field. */
export function upcomingMatchNotificationForTeam(input: {
  message: UpcomingMatchMessage;
  teamNumber: number | null;
  now: Date;
}): NotificationContent {
  const label = describeMatchKey(input.message.matchKey);
  const minutes = minutesUntil(input.message.scheduledSeconds, input.now);
  const opponents = input.message.teamKeys.map(teamNumberLabel).join(", ");
  const you = input.teamNumber ? `${input.teamNumber} is on deck` : "Your team is on deck";
  return {
    title: `${you} — ${label} ${countdownPhrase(minutes)}`,
    body: opponents ? `Field: ${opponents}` : "Check the schedule for the field.",
    url: "/competition",
    tag: `upcoming-team:${input.message.matchKey ?? "match"}`,
    urgent: minutes == null || minutes <= 15,
  };
}

export type MatchScoreMessage = {
  eventKey: string | null;
  eventName: string | null;
  matchKey: string | null;
  redScore: number | null;
  blueScore: number | null;
  redTeams: string[];
  blueTeams: string[];
  winningAlliance: string | null;
};

function readAllianceTeams(match: Record<string, unknown>, color: "red" | "blue"): string[] {
  const alliances = match.alliances;
  if (!alliances || typeof alliances !== "object" || Array.isArray(alliances)) return [];
  const side = (alliances as Record<string, unknown>)[color];
  if (!side || typeof side !== "object" || Array.isArray(side)) return [];
  return readStringArray(side as Record<string, unknown>, "team_keys");
}

function readAllianceScore(match: Record<string, unknown>, color: "red" | "blue"): number | null {
  const alliances = match.alliances;
  if (!alliances || typeof alliances !== "object" || Array.isArray(alliances)) return null;
  const side = (alliances as Record<string, unknown>)[color];
  if (!side || typeof side !== "object" || Array.isArray(side)) return null;
  return readNumber(side as Record<string, unknown>, "score");
}

export function readMatchScore(envelope: TbaEnvelope): MatchScoreMessage {
  const nested = envelope.messageData.match;
  const match =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : {};
  return {
    eventKey: eventKeyForMessage(envelope),
    eventName: readString(envelope.messageData, "event_name"),
    matchKey: matchKeyForMessage(envelope),
    redScore: readAllianceScore(match, "red"),
    blueScore: readAllianceScore(match, "blue"),
    redTeams: readAllianceTeams(match, "red"),
    blueTeams: readAllianceTeams(match, "blue"),
    winningAlliance: readString(match, "winning_alliance"),
  };
}

/**
 * Result text. When TBA did not include scores we say the result posted rather than
 * printing a fake `0 – 0` — a wrong score on a phone is worse than no score.
 */
export function matchScoreNotification(input: {
  message: MatchScoreMessage;
  teamNumber: number | null;
}): NotificationContent {
  const label = describeMatchKey(input.message.matchKey);
  const { redScore, blueScore } = input.message;
  const hasScores = redScore != null && blueScore != null;
  const teamKey = input.teamNumber ? teamKeyForNumber(input.teamNumber).toLowerCase() : null;
  const onRed = teamKey ? input.message.redTeams.some((k) => k.toLowerCase() === teamKey) : false;
  const onBlue = teamKey ? input.message.blueTeams.some((k) => k.toLowerCase() === teamKey) : false;

  let title = `${label} result posted`;
  if (hasScores && (onRed || onBlue)) {
    const ours = onRed ? redScore : blueScore;
    const theirs = onRed ? blueScore : redScore;
    const verdict = ours > theirs ? "Win" : ours < theirs ? "Loss" : "Tie";
    title = `${label}: ${verdict} ${ours}–${theirs}`;
  } else if (hasScores) {
    title = `${label}: Red ${redScore} – Blue ${blueScore}`;
  }

  return {
    title,
    body: hasScores
      ? "Log the debrief while it is fresh."
      : "Scores are not in the feed yet — open the match to review.",
    url: "/competition",
    tag: `score:${input.message.matchKey ?? "match"}`,
    urgent: false,
  };
}

export function scheduleUpdatedNotification(input: {
  eventKey: string | null;
  eventName: string | null;
  firstMatchSeconds: number | null;
}): NotificationContent {
  const where = input.eventName ?? input.eventKey ?? "your event";
  return {
    title: `Schedule updated at ${where}`,
    body:
      input.firstMatchSeconds != null
        ? "Match times moved. Re-check scout assignments and pit duties."
        : "The event schedule changed. Re-check scout assignments and pit duties.",
    url: "/schedule",
    tag: `schedule:${input.eventKey ?? "event"}`,
    urgent: false,
  };
}

export function allianceSelectionNotification(input: {
  eventKey: string | null;
  eventName: string | null;
  allianceCount: number;
}): NotificationContent {
  const where = input.eventName ?? input.eventKey ?? "your event";
  return {
    title: `Alliances are set at ${where}`,
    body:
      input.allianceCount > 0
        ? `${input.allianceCount} alliances posted. Open the selection desk for the bracket.`
        : "Alliance selection posted. Open the selection desk for the bracket.",
    url: "/alliance-selection-desk",
    tag: `alliances:${input.eventKey ?? "event"}`,
    urgent: false,
  };
}

/** TBA's one-time handshake. The code has to be typed back into the TBA account page. */
export function readVerificationKey(envelope: TbaEnvelope): string | null {
  return (
    readString(envelope.messageData, "verification_key") ??
    readString(envelope.messageData, "verification_code")
  );
}

export function readAllianceCount(envelope: TbaEnvelope): number {
  const alliances = envelope.messageData.alliances;
  return Array.isArray(alliances) ? alliances.length : 0;
}

export function readFirstMatchSeconds(envelope: TbaEnvelope): number | null {
  return readNumber(envelope.messageData, "first_match_time");
}

export function readEventName(envelope: TbaEnvelope): string | null {
  return readString(envelope.messageData, "event_name");
}

/** Message types this pipeline turns into notifications. Everything else is stored only. */
export const ACTIONABLE_TBA_MESSAGE_TYPES = [
  "upcoming_match",
  "match_score",
  "schedule_updated",
  "alliance_selection",
] as const;

export type ActionableTbaMessageType = (typeof ACTIONABLE_TBA_MESSAGE_TYPES)[number];

export function isActionableMessageType(type: string): type is ActionableTbaMessageType {
  return (ACTIONABLE_TBA_MESSAGE_TYPES as readonly string[]).includes(type);
}
