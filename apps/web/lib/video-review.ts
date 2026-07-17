// Match Video Review — framework-free domain logic shared by the API route,
// the client UI, and unit tests. No server or React imports belong here.

import { parseYouTubeEmbed } from "./youtube";

export const NOTE_TAGS = ["auto", "teleop", "endgame", "defense", "failure", "strategy", "other"] as const;

export type NoteTag = (typeof NOTE_TAGS)[number];

export const TAG_LABELS: Record<NoteTag, string> = {
  auto: "Auto",
  teleop: "Teleop",
  endgame: "Endgame",
  defense: "Defense",
  failure: "Failure",
  strategy: "Strategy",
  other: "Other",
};

export type VideoNote = {
  id: string;
  reviewId: string;
  atSeconds: number;
  tag: NoteTag;
  body: string;
  createdByName: string | null;
  createdAt: string;
};

export type VideoReview = {
  id: string;
  title: string;
  url: string;
  videoId: string;
  matchKey: string | null;
  teamKey: string | null;
  /** Long-form review text (stored in the DB `notes` column). */
  summary: string;
  createdByName: string | null;
  updatedAt: string;
  notes: VideoNote[];
};

export type VideoContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
};

export type VideoView =
  | { status: "ready"; context: VideoContext; reviews: VideoReview[] }
  | { status: "setup_required"; context: VideoContext; message: string };

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested).
// ---------------------------------------------------------------------------

export const MAX_NOTE_SECONDS = 21_600; // 6 hours — longer than any FRC stream.

/** Format seconds as "m:ss", or "h:mm:ss" once the video is an hour or longer. */
export function fmtTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (total >= 3600) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

/** Parse "83", "1:23", or "1:02:03" into whole seconds. Throws on bad input. */
export function parseTimestampInput(raw: string): number {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Enter a timestamp like 1:23");
  const parts = text.split(":");
  if (parts.length > 3) throw new Error("Enter a timestamp like 1:23 or 1:02:03");
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = (parts[index] ?? "").trim();
    if (!/^\d+$/.test(part)) throw new Error("Enter a timestamp like 1:23");
    const value = Number(part);
    if (Number.isNaN(value)) throw new Error("Enter a timestamp like 1:23");
    if (parts.length > 1 && index > 0 && value >= 60) {
      throw new Error("Minutes and seconds must be below 60");
    }
    total = total * 60 + value;
  }
  if (total > MAX_NOTE_SECONDS) throw new Error("Timestamps must be within 6 hours");
  return total;
}

/** Notes in playback order: ascending seconds, then creation time. */
export function sortNotes(notes: VideoNote[]): VideoNote[] {
  return [...notes].sort((a, b) => a.atSeconds - b.atSeconds || a.createdAt.localeCompare(b.createdAt));
}

/** Per-tag note counts, zero-filled so every tag chip can render a number. */
export function tagCounts(notes: VideoNote[]): Record<NoteTag, number> {
  const counts = {} as Record<NoteTag, number>;
  for (const tag of NOTE_TAGS) counts[tag] = 0;
  for (const note of notes) counts[note.tag] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Action validation (mirrors the other module parse patterns).
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function noteTag(value: unknown): NoteTag {
  const text = String(value ?? "other").trim().toLowerCase() || "other";
  if (!(NOTE_TAGS as readonly string[]).includes(text)) throw new Error("Unknown note tag");
  return text as NoteTag;
}

function noteSeconds(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 0 || seconds > MAX_NOTE_SECONDS) {
    throw new Error("Timestamp must be between 0:00 and 6:00:00");
  }
  return seconds;
}

function patchObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

const hasOwn = (object: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(object, key);

export type ReviewPatch = {
  title?: string;
  matchKey?: string | null;
  teamKey?: string | null;
  summary?: string;
};

export type NotePatch = {
  atSeconds?: number;
  tag?: NoteTag;
  body?: string;
};

export type VideoAction =
  | {
      action: "create_review";
      orgId: string;
      title: string;
      url: string;
      videoId: string;
      matchKey: string | null;
      teamKey: string | null;
    }
  | { action: "update_review"; orgId: string; id: string; patch: ReviewPatch }
  | { action: "delete_review"; orgId: string; id: string }
  | { action: "add_note"; orgId: string; reviewId: string; atSeconds: number; tag: NoteTag; body: string }
  | { action: "update_note"; orgId: string; id: string; patch: NotePatch }
  | { action: "delete_note"; orgId: string; id: string };

export function parseVideoAction(input: unknown): VideoAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid video action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_review": {
      const url = requiredText(body.url, "YouTube URL", 400);
      const embed = parseYouTubeEmbed(url);
      if (!embed) throw new Error("Enter a valid YouTube URL");
      return {
        action,
        orgId,
        title: requiredText(body.title, "Review title", 160),
        url,
        videoId: embed.videoId,
        matchKey: optionalText(body.matchKey, 40),
        teamKey: optionalText(body.teamKey, 20),
      };
    }

    case "update_review": {
      const id = uuid(body.id, "Review");
      const patchInput = patchObject(body.patch);
      const patch: ReviewPatch = {};
      if (hasOwn(patchInput, "title")) patch.title = requiredText(patchInput.title, "Review title", 160);
      if (hasOwn(patchInput, "matchKey")) patch.matchKey = optionalText(patchInput.matchKey, 40);
      if (hasOwn(patchInput, "teamKey")) patch.teamKey = optionalText(patchInput.teamKey, 20);
      if (hasOwn(patchInput, "summary")) patch.summary = optionalText(patchInput.summary, 20_000) ?? "";
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id, patch };
    }

    case "delete_review":
      return { action, orgId, id: uuid(body.id, "Review") };

    case "add_note": {
      const atSeconds =
        typeof body.atSeconds === "number" ? noteSeconds(body.atSeconds) : parseTimestampInput(String(body.timestamp ?? ""));
      return {
        action,
        orgId,
        reviewId: uuid(body.reviewId, "Review"),
        atSeconds,
        tag: noteTag(body.tag),
        body: requiredText(body.body, "Note", 2000),
      };
    }

    case "update_note": {
      const id = uuid(body.id, "Note");
      const patchInput = patchObject(body.patch);
      const patch: NotePatch = {};
      if (hasOwn(patchInput, "atSeconds")) patch.atSeconds = noteSeconds(patchInput.atSeconds);
      if (hasOwn(patchInput, "tag")) patch.tag = noteTag(patchInput.tag);
      if (hasOwn(patchInput, "body")) patch.body = requiredText(patchInput.body, "Note", 2000);
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id, patch };
    }

    case "delete_note":
      return { action, orgId, id: uuid(body.id, "Note") };

    default:
      throw new Error("Unsupported video action");
  }
}
