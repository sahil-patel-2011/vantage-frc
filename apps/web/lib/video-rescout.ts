// Post-match video re-scouting — pure domain helpers (API, Soft-UI, tests).

import type { Confidence, FieldDefinition, SchemaDefinition, SyncEntry } from "@vantage/scouting";
import { MAX_NOTE_SECONDS, type VideoNote } from "./video-review";

export const MAX_RESCOUT_TEAMS = 4;
export const PLAYBACK_RATES = [1, 1.5, 2] as const;
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];
export const REWIND_SECONDS = 5;
export const FORWARD_SECONDS = 5;

export type TimelineScore = {
  id: string;
  reviewId: string;
  teamKey: string;
  atSeconds: number;
  fieldKey: string;
  value: unknown;
  createdByName: string | null;
  createdAt: string;
};

export type RescoutReview = {
  id: string;
  title: string;
  url: string;
  videoId: string;
  matchKey: string | null;
  teamKey: string | null;
  assignedTeamKeys: string[];
  summary: string;
  createdByName: string | null;
  updatedAt: string;
  notes: VideoNote[];
  scores: TimelineScore[];
};

export type RescoutView =
  | {
      status: "ready";
      context: { orgId: string; orgName: string; teamNumber: number | null; role: string };
      eventKey: string | null;
      matchSchema: {
        id: string;
        title: string;
        fields: Array<{ key: string; label: string; type: string; options?: string[] }>;
      } | null;
      reviews: RescoutReview[];
    }
  | {
      status: "setup_required";
      context: { orgId: null; orgName: null; teamNumber: null; role: null };
      message: string;
    };

export type RescoutSchemaField = Pick<FieldDefinition, "key" | "label" | "type" | "options">;

export function normalizeTeamKey(raw: string): string {
  const text = String(raw ?? "").trim().toLowerCase();
  if (!text) throw new Error("Team number is required");
  if (/^frc\d{1,5}$/.test(text)) return text;
  const digits = text.replace(/\D/g, "");
  if (!digits || digits.length > 5) throw new Error("Enter a team number like 254");
  return `frc${Number(digits)}`;
}

export function parseAssignedTeams(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : String(raw ?? "")
        .split(/[\s,]+/)
        .filter(Boolean);
  if (list.length === 0) throw new Error("Assign at least one team to re-scout");
  if (list.length > MAX_RESCOUT_TEAMS) throw new Error(`Assign at most ${MAX_RESCOUT_TEAMS} teams per scout`);
  const keys = list.map((entry) => normalizeTeamKey(String(entry)));
  const unique = [...new Set(keys)];
  if (unique.length !== keys.length) throw new Error("Duplicate teams in assignment");
  return unique;
}

export function clampPlaybackRate(rate: number): PlaybackRate {
  if (rate >= 2) return 2;
  if (rate >= 1.5) return 1.5;
  return 1;
}

export function nextPlaybackRate(current: number): PlaybackRate {
  const index = PLAYBACK_RATES.indexOf(clampPlaybackRate(current));
  return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length]!;
}

export function seekSeconds(current: number, delta: number, duration = MAX_NOTE_SECONDS): number {
  const next = Math.floor(current) + delta;
  if (next < 0) return 0;
  if (next > duration) return Math.max(0, Math.floor(duration));
  return next;
}

export function sortTimelineScores(scores: TimelineScore[]): TimelineScore[] {
  return [...scores].sort(
    (a, b) => a.atSeconds - b.atSeconds || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

export function aggregateTeamPayload(
  scores: TimelineScore[],
  teamKey: string,
  schema: SchemaDefinition,
): Record<string, unknown> {
  const fields = new Map(schema.fields.map((field) => [field.key, field]));
  const payload: Record<string, unknown> = {};
  for (const tick of sortTimelineScores(scores.filter((entry) => entry.teamKey === teamKey))) {
    const field = fields.get(tick.fieldKey);
    if (!field) continue;
    if (field.type === "number") {
      const delta = typeof tick.value === "number" && Number.isFinite(tick.value) ? tick.value : Number(tick.value);
      if (!Number.isFinite(delta)) continue;
      const prev = typeof payload[field.key] === "number" ? (payload[field.key] as number) : 0;
      payload[field.key] = prev + delta;
    } else if (field.type === "boolean") {
      payload[field.key] = Boolean(tick.value);
    } else {
      payload[field.key] = String(tick.value ?? "");
    }
  }
  return payload;
}

export function scoreCountByTeam(scores: TimelineScore[], teamKeys: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of teamKeys) counts[key] = 0;
  for (const score of scores) {
    if (counts[score.teamKey] != null) counts[score.teamKey] += 1;
  }
  return counts;
}

export function scoreMarkerLabel(fieldKey: string, value: unknown): string {
  if (typeof value === "boolean") return value ? `${fieldKey}:yes` : `${fieldKey}:no`;
  if (typeof value === "number") return `${fieldKey}${value > 0 ? "+" : ""}${value}`;
  return `${fieldKey}:${String(value)}`;
}

/** Stable offline/client id for a video re-scout team rollup. */
export function videoRescoutClientId(reviewId: string, teamKey: string): string {
  return `video-rescout:${reviewId}:${teamKey}`;
}

export function buildVideoRescoutSyncEntries(input: {
  reviewId: string;
  eventKey: string;
  matchKey: string;
  schemaId: string;
  assignedTeamKeys: string[];
  scores: TimelineScore[];
  schema: SchemaDefinition;
  confidence?: Confidence;
  updatedAt?: string;
}): SyncEntry[] {
  const confidence = input.confidence ?? "normal";
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const entries: SyncEntry[] = [];
  for (const teamKey of input.assignedTeamKeys) {
    const teamScores = sortTimelineScores(input.scores.filter((entry) => entry.teamKey === teamKey));
    if (teamScores.length === 0) continue;
    const payload = aggregateTeamPayload(teamScores, teamKey, input.schema);
    const anchor = teamScores.at(-1)!;
    entries.push({
      clientId: videoRescoutClientId(input.reviewId, teamKey),
      type: "match",
      eventKey: input.eventKey,
      matchKey: input.matchKey,
      teamKey,
      schemaId: input.schemaId,
      payload,
      confidence,
      source: "video",
      updatedAt,
      videoReviewId: input.reviewId,
      videoAtSeconds: anchor.atSeconds,
    });
  }
  return entries;
}

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function noteSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_NOTE_SECONDS) {
    throw new Error("Timestamp must be between 0:00 and 6:00:00");
  }
  return seconds;
}

function jsonValue(value: unknown): unknown {
  if (value === null || value === undefined) throw new Error("Score value is required");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") return value;
  throw new Error("Score value must be a number, boolean, or text");
}

export type VideoRescoutAction =
  | { action: "set_assigned_teams"; orgId: string; reviewId: string; teamKeys: string[] }
  | {
      action: "add_score";
      orgId: string;
      reviewId: string;
      teamKey: string;
      atSeconds: number;
      fieldKey: string;
      value: unknown;
    }
  | { action: "delete_score"; orgId: string; id: string }
  | { action: "commit_rescout"; orgId: string; reviewId: string; schemaId: string; confidence?: "high" | "normal" | "low" };

export function parseVideoRescoutAction(input: unknown): VideoRescoutAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid video re-scout action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");
  switch (action) {
    case "set_assigned_teams":
      return { action, orgId, reviewId: uuid(body.reviewId, "Review"), teamKeys: parseAssignedTeams(body.teamKeys ?? body.teams) };
    case "add_score":
      return {
        action,
        orgId,
        reviewId: uuid(body.reviewId, "Review"),
        teamKey: normalizeTeamKey(String(body.teamKey ?? "")),
        atSeconds: noteSeconds(body.atSeconds),
        fieldKey: requiredText(body.fieldKey, "Field", 80),
        value: jsonValue(body.value),
      };
    case "delete_score":
      return { action, orgId, id: uuid(body.id, "Score") };
    case "commit_rescout": {
      const confidenceRaw = String(body.confidence ?? "normal").trim().toLowerCase();
      if (confidenceRaw !== "high" && confidenceRaw !== "low" && confidenceRaw !== "normal") {
        throw new Error("Confidence must be high, normal, or low");
      }
      return {
        action,
        orgId,
        reviewId: uuid(body.reviewId, "Review"),
        schemaId: uuid(body.schemaId, "Schema"),
        confidence: confidenceRaw,
      };
    }
    default:
      throw new Error("Unsupported video re-scout action");
  }
}
