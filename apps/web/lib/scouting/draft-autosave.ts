import type { ScoutSchema } from "@vantage/scouting";
import { schemaPublicationRequest } from "./schema-publication";

/**
 * Device-local scout entry drafts — never invents DEMO rows; cleared after a real queue/save.
 */

export type ScoutDraftSnapshot = {
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
  matchKey: string;
  teamKey: string;
  savedAt: string;
  /** Corrections and interrupted saves must resume the same report, not create a duplicate. */
  clientId?: string;
  schemaId?: string;
  /** Keep published questions with the personal draft for offline recovery. */
  schema?: ScoutSchema;
  source?: "manual" | "voice";
};

export function scoutDraftStorageKey(input: {
  userId?: string | null;
  orgId: string;
  eventKey: string;
  entryType: "match" | "pit";
  matchKey?: string;
  teamKey: string;
}): string | null {
  const orgId = input.orgId.trim();
  const eventKey = input.eventKey.trim();
  const teamKey = input.teamKey.trim();
  const userId = input.userId?.trim();
  if (!userId || !orgId || !eventKey || !teamKey) return null;
  const matchPart = input.entryType === "match" ? (input.matchKey?.trim() || "_") : "pit";
  return `vantage-scout-draft-person:${encodeURIComponent(userId)}:${orgId}:${eventKey}:${input.entryType}:${matchPart}:${teamKey}`;
}

export function readScoutDraft(key: string | null): ScoutDraftSnapshot | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScoutDraftSnapshot;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (typeof parsed.savedAt !== "string" || !Number.isFinite(Date.parse(parsed.savedAt))) return null;
    if (!parsed.payload || typeof parsed.payload !== "object" || Array.isArray(parsed.payload)) return null;
    if (!["high", "normal", "low"].includes(parsed.confidence)) return null;
    if (typeof parsed.matchKey !== "string" || typeof parsed.teamKey !== "string" || !parsed.teamKey.trim()) return null;
    if (parsed.clientId !== undefined && (typeof parsed.clientId !== "string" || !parsed.clientId.trim())) return null;
    if (parsed.schemaId !== undefined && (typeof parsed.schemaId !== "string" || !parsed.schemaId.trim())) return null;
    if (parsed.source !== undefined && parsed.source !== "manual" && parsed.source !== "voice") return null;
    if (parsed.schema !== undefined) {
      const form = parsed.schema;
      const valid = form && typeof form === "object" && form.id === parsed.schemaId
        && Number.isInteger(form.version) && form.version > 0
        && schemaPublicationRequest.safeParse({ orgId: form.orgId, year: form.year, type: form.type, definition: form.definition }).success;
      // Keep answers and the pinned ID even when an older snapshot is unreadable.
      if (!valid) delete parsed.schema;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeScoutDraft(key: string | null, draft: Omit<ScoutDraftSnapshot, "savedAt">): string | null {
  if (!key || typeof window === "undefined") return null;
  const savedAt = new Date().toISOString();
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...draft, savedAt }));
    return savedAt;
  } catch {
    return null;
  }
}

export function clearScoutDraft(key: string | null): boolean {
  if (!key) return true;
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${key}:clock`);
    return window.localStorage.getItem(key) === null && window.localStorage.getItem(`${key}:clock`) === null;
  } catch {
    return false;
  }
}

export function readScoutClock(key: string | null, now = Date.now()): number | null {
  if (!key || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${key}:clock`);
    const startedAt = raw === null ? NaN : Number(raw);
    return Number.isFinite(startedAt) && startedAt > 0 && startedAt <= now ? startedAt : null;
  } catch { return null; }
}

export function writeScoutClock(key: string | null, startedAt: number | null): void {
  if (!key || typeof window === "undefined") return;
  try {
    if (startedAt === null) window.localStorage.removeItem(`${key}:clock`);
    else window.localStorage.setItem(`${key}:clock`, String(startedAt));
  } catch { /* The form still works when local storage is unavailable. */ }
}

type DraftContext = { userId: string; orgId: string; eventKey: string };
type ActiveDraft = { key: string; type: "match" | "pit"; matchKey: string; teamKey: string };
function activeDraftKey(context: DraftContext): string {
  return `vantage-scout-active:${encodeURIComponent(context.userId)}:${context.orgId}:${context.eventKey}`;
}

export function rememberActiveScoutDraft(context: DraftContext, draft: ActiveDraft): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(activeDraftKey(context), JSON.stringify(draft)); } catch { /* Keep the saved draft itself. */ }
}

export function readActiveScoutDraft(context: DraftContext): ActiveDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(activeDraftKey(context));
    if (!raw) return null;
    const draft = JSON.parse(raw) as ActiveDraft;
    if (draft.type !== "match" && draft.type !== "pit") return null;
    if (typeof draft.matchKey !== "string" || typeof draft.teamKey !== "string") return null;
    const expected = scoutDraftStorageKey({ ...context, entryType: draft.type, matchKey: draft.matchKey, teamKey: draft.teamKey });
    return expected === draft.key && (readScoutDraft(expected) || readScoutClock(expected)) ? draft : null;
  } catch { return null; }
}

export function formatDraftSavedAgo(savedAt: string | null, nowMs = Date.now()): string {
  if (!savedAt) return "Unsaved changes";
  const then = Date.parse(savedAt);
  if (!Number.isFinite(then)) return "Draft saved";
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (seconds < 5) return "Draft saved just now";
  if (seconds < 60) return `Draft saved ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return `Draft saved ${minutes}m ago`;
}

export function payloadHasDraftContent(payload: Record<string, unknown>): boolean {
  return Object.values(payload).some((value) => {
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "boolean") return true;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return false;
  });
}
