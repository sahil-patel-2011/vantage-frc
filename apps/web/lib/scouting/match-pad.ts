/**
 * Match pad — live-match taps that map onto scout keys Intel already averages.
 * Counts and rates come from events that happened. Missing keys stay absent.
 */

export const MATCH_PAD_EVENT_TYPES = ["score", "feed", "defend", "climb", "note"] as const;
export type MatchPadEventType = (typeof MATCH_PAD_EVENT_TYPES)[number];

export const MATCH_PAD_PHASES = ["auto", "teleop", "endgame"] as const;
export type MatchPadPhase = (typeof MATCH_PAD_PHASES)[number];

export type MatchPadEvent = {
  id: string;
  type: MatchPadEventType;
  phase: MatchPadPhase;
  at: string;
  note?: string;
};

/** Scout keys Intel already reads. Never 0-fill these when nothing was tapped. */
export const MATCH_PAD_SCOUT_KEYS = [
  "feedingRate",
  "scoringRate",
  "totalFuelFed",
  "estimatedTotalFuelScored",
  "totalDefenseTime",
  "autoClimb",
  "reliability",
] as const;

export type MatchPadScoutKey = (typeof MATCH_PAD_SCOUT_KEYS)[number];

export type MatchPadPoint = { t: number; x: number; y: number };

export type MatchPadPayload = Partial<Record<MatchPadScoutKey, number>> & {
  scoresWhileMoving?: 1;
  autoPath?: MatchPadPoint[];
};

export const MATCH_PAD_EVENTS_KEY = "matchPadEvents";
export const MATCH_PAD_PATH_KEY = "autoPath";
export const MATCH_PAD_FIELD_WIDTH = 54;
export const MATCH_PAD_FIELD_HEIGHT = 27;

export type MatchPadQuals = {
  driverAbility?: number;
  defenseEffectiveness?: number;
};

export function actionsForPhase(phase: MatchPadPhase): MatchPadEventType[] {
  switch (phase) {
    case "auto":
      return ["score", "feed"];
    case "teleop":
      return ["score", "feed", "defend"];
    case "endgame":
      return ["climb", "defend"];
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

/** True only when at least one score or feed was logged. Never invented. */
export function scoresWhileMoving(events: readonly MatchPadEvent[]): boolean {
  return events.some((event) => event.type === "score" || event.type === "feed");
}

function isMatchPadEventType(value: unknown): value is MatchPadEventType {
  return typeof value === "string" && (MATCH_PAD_EVENT_TYPES as readonly string[]).includes(value);
}

function isMatchPadPhase(value: unknown): value is MatchPadPhase {
  return typeof value === "string" && (MATCH_PAD_PHASES as readonly string[]).includes(value);
}

function parsePadEvent(value: unknown): MatchPadEvent | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  if (!isMatchPadEventType(record.type)) return null;
  if (!isMatchPadPhase(record.phase)) return null;
  if (typeof record.at !== "string" || record.at.length === 0) return null;
  if (!Number.isFinite(Date.parse(record.at))) return null;
  const event: MatchPadEvent = {
    id: record.id,
    type: record.type,
    phase: record.phase,
    at: record.at,
  };
  if (typeof record.note === "string") {
    const note = record.note.trim();
    if (note) event.note = note;
  }
  return event;
}

/** Persistable copy of pad events. Junk rows are dropped. */
export function serializePad(events: readonly MatchPadEvent[]): MatchPadEvent[] {
  const stored: MatchPadEvent[] = [];
  for (const event of events) {
    const parsed = parsePadEvent(event);
    if (parsed) stored.push(parsed);
  }
  return stored;
}

/** Restore pad events from a form payload. Missing or junk → []. */
export function eventsFromPayload(payload: Record<string, unknown> | null | undefined): MatchPadEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const raw = payload[MATCH_PAD_EVENTS_KEY];
  if (!Array.isArray(raw)) return [];
  return serializePad(raw as MatchPadEvent[]);
}

function asFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pointFromUnknown(value: unknown, index: number): MatchPadPoint | null {
  if (Array.isArray(value)) {
    if (value.length >= 3) {
      const t = asFinite(value[0]);
      const x = asFinite(value[1]);
      const y = asFinite(value[2]);
      if (t == null || x == null || y == null) return null;
      return { t, x, y };
    }
    if (value.length === 2) {
      const x = asFinite(value[0]);
      const y = asFinite(value[1]);
      if (x == null || y == null) return null;
      return { t: index, x, y };
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const x = asFinite(row.x);
  const y = asFinite(row.y);
  if (x == null || y == null) return null;
  const t = asFinite(row.t) ?? index;
  return { t, x, y };
}

/** Real tap list only — one finite point is a pose, not a path. */
export function pathFromTaps(points: readonly unknown[]): MatchPadPoint[] | null {
  const path: MatchPadPoint[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = pointFromUnknown(points[index], index);
    if (point) path.push(point);
  }
  return path.length < 2 ? null : path;
}

/** Restore autoPath from a form payload. Missing or junk → null. */
export function pathFromPayload(payload: Record<string, unknown> | null | undefined): MatchPadPoint[] | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload[MATCH_PAD_PATH_KEY];
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const path: MatchPadPoint[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const point = pointFromUnknown(raw[index], index);
    if (!point) return null;
    path.push(point);
  }
  return path.length < 2 ? null : path;
}

function parseQualRating(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(n) || n < 1 || n > 5) return undefined;
  return n;
}

/** Post-match 1–5 quals. Unset / blank / out of range keys are omitted — never 0. */
export function qualsFromInputs(inputs: {
  driverAbility?: unknown;
  defenseEffectiveness?: unknown;
}): MatchPadQuals {
  const quals: MatchPadQuals = {};
  const driverAbility = parseQualRating(inputs.driverAbility);
  const defenseEffectiveness = parseQualRating(inputs.defenseEffectiveness);
  if (driverAbility != null) quals.driverAbility = driverAbility;
  if (defenseEffectiveness != null) quals.defenseEffectiveness = defenseEffectiveness;
  return quals;
}

export function actionLabel(type: MatchPadEventType): string {
  switch (type) {
    case "score":
      return "Score";
    case "feed":
      return "Feed";
    case "defend":
      return "Defend";
    case "climb":
      return "Climb";
    case "note":
      return "Note";
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

export function phaseLabel(phase: MatchPadPhase): string {
  switch (phase) {
    case "auto":
      return "Auto";
    case "teleop":
      return "Teleop";
    case "endgame":
      return "Endgame";
    default: {
      const exhaustive: never = phase;
      return exhaustive;
    }
  }
}

function eventTimeMs(event: MatchPadEvent): number | null {
  const ms = Date.parse(event.at);
  return Number.isFinite(ms) ? ms : null;
}

function spanSec(events: readonly MatchPadEvent[]): number | null {
  const times = events
    .map(eventTimeMs)
    .filter((ms): ms is number => ms != null)
    .sort((a, b) => a - b);
  if (times.length < 2) return null;
  const first = times[0];
  const last = times[times.length - 1];
  if (first == null || last == null) return null;
  const sec = (last - first) / 1000;
  return sec > 0 ? sec : null;
}

function resolveDurationSec(
  events: readonly MatchPadEvent[],
  overrideSec: number | undefined,
): number | null {
  if (overrideSec != null) {
    return overrideSec > 0 && Number.isFinite(overrideSec) ? overrideSec : null;
  }
  return spanSec(events);
}

/**
 * Map pad events onto Intel scout keys. Rates use count / duration only when
 * duration is > 0 and the count exists. Empty pads return no scout metrics.
 */
export function payloadFromPad(
  events: readonly MatchPadEvent[],
  options?: { durationSec?: number; path?: readonly MatchPadPoint[] },
): MatchPadPayload {
  const payload: MatchPadPayload = {};
  const path = pathFromTaps(options?.path ?? []);
  if (path) payload.autoPath = path;
  if (events.length === 0) return payload;

  const feeds = events.filter((event) => event.type === "feed");
  const scores = events.filter((event) => event.type === "score");
  const defends = events.filter((event) => event.type === "defend");
  const autoClimbs = events.filter((event) => event.type === "climb" && event.phase === "auto");

  if (feeds.length > 0) payload.totalFuelFed = feeds.length;
  if (scores.length > 0) payload.estimatedTotalFuelScored = scores.length;
  if (autoClimbs.length > 0) payload.autoClimb = 1;
  if (scoresWhileMoving(events)) payload.scoresWhileMoving = 1;

  const durationSec = resolveDurationSec(events, options?.durationSec);
  if (durationSec != null && durationSec > 0) {
    const minutes = durationSec / 60;
    if (feeds.length > 0) payload.feedingRate = feeds.length / minutes;
    if (scores.length > 0) payload.scoringRate = scores.length / minutes;
    const defendSpan = spanSec(defends);
    if (defendSpan != null && defendSpan > 0) payload.totalDefenseTime = defendSpan;
  }

  return payload;
}
