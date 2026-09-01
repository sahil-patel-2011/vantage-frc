import { WATCH_KIND_LABELS, WATCH_KINDS, type WatchKind } from "./types";

export function isWatchKind(value: unknown): value is WatchKind {
  return typeof value === "string" && (WATCH_KINDS as readonly string[]).includes(value);
}

export function defaultWatchTitle(kind: WatchKind): string {
  return WATCH_KIND_LABELS[kind];
}

function requiredText(value: unknown, label: string, max: number): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

function optionalUuid(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return uuid(value, label);
}

function isoDateTime(value: unknown, label: string): string {
  const text = requiredText(value, label, 64);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} must be a valid date/time`);
  return date.toISOString();
}

function optionalIsoDateTime(value: unknown, label: string): string | null {
  if (value == null || String(value).trim() === "") return null;
  return isoDateTime(value, label);
}

export const WATCH_ACTIONS = ["assign_watch", "update_watch", "delete_watch"] as const;
export type WatchActionName = (typeof WATCH_ACTIONS)[number];

export function isWatchActionName(value: unknown): value is WatchActionName {
  return typeof value === "string" && (WATCH_ACTIONS as readonly string[]).includes(value);
}

export type WatchAction =
  | {
      action: "assign_watch";
      orgId: string;
      kind: WatchKind;
      title: string;
      assignedUserId: string;
      startsAt: string;
      endsAt: string | null;
      phone: string;
      locationNote: string;
      notes: string;
    }
  | {
      action: "update_watch";
      orgId: string;
      id: string;
      kind?: WatchKind;
      title?: string;
      assignedUserId?: string | null;
      startsAt?: string;
      endsAt?: string | null;
      phone?: string;
      locationNote?: string;
      notes?: string;
    }
  | { action: "delete_watch"; orgId: string; id: string };

/**
 * Assign requires a roster member. Open slots are not a My Day cue — posting
 * someone as on-duty / chaperone is the write this surface exists for.
 */
export function parseWatchAction(input: unknown): WatchAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid duty action");
  }
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "assign_watch": {
      if (!isWatchKind(body.kind)) throw new Error("Kind is invalid");
      const assignedUserId = optionalUuid(body.assignedUserId, "Assignee");
      if (!assignedUserId) throw new Error("Pick a teammate to put on duty");
      const startsAt = isoDateTime(body.startsAt, "Start");
      const endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (endsAt && endsAt < startsAt) throw new Error("End must be on or after start");
      const title =
        body.title == null || String(body.title).trim() === ""
          ? defaultWatchTitle(body.kind)
          : requiredText(body.title, "Title", 200);
      return {
        action,
        orgId,
        kind: body.kind,
        title,
        assignedUserId,
        startsAt,
        endsAt,
        phone: optionalText(body.phone, 40),
        locationNote: optionalText(body.locationNote, 200),
        notes: optionalText(body.notes, 2000),
      };
    }
    case "update_watch": {
      const id = uuid(body.id, "Duty");
      const patch: Extract<WatchAction, { action: "update_watch" }> = { action, orgId, id };
      if (body.kind !== undefined) {
        if (!isWatchKind(body.kind)) throw new Error("Kind is invalid");
        patch.kind = body.kind;
      }
      if (body.title !== undefined) patch.title = requiredText(body.title, "Title", 200);
      if (body.assignedUserId !== undefined) {
        patch.assignedUserId = optionalUuid(body.assignedUserId, "Assignee");
      }
      if (body.startsAt !== undefined) patch.startsAt = isoDateTime(body.startsAt, "Start");
      if (body.endsAt !== undefined) patch.endsAt = optionalIsoDateTime(body.endsAt, "End");
      if (body.phone !== undefined) patch.phone = optionalText(body.phone, 40);
      if (body.locationNote !== undefined) patch.locationNote = optionalText(body.locationNote, 200);
      if (body.notes !== undefined) patch.notes = optionalText(body.notes, 2000);
      if (
        patch.startsAt &&
        patch.endsAt &&
        patch.endsAt < patch.startsAt
      ) {
        throw new Error("End must be on or after start");
      }
      return patch;
    }
    case "delete_watch":
      return { action, orgId, id: uuid(body.id, "Duty") };
    default:
      throw new Error("Unsupported duty action");
  }
}
