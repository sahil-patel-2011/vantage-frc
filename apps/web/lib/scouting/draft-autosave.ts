/**
 * Device-local scout entry drafts — never invents DEMO rows; cleared after a real queue/save.
 */

export type ScoutDraftSnapshot = {
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
  matchKey: string;
  teamKey: string;
  savedAt: string;
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
    if (!parsed || typeof parsed !== "object" || typeof parsed.savedAt !== "string") return null;
    if (!parsed.payload || typeof parsed.payload !== "object") return null;
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

export function clearScoutDraft(key: string | null): void {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
    window.localStorage.removeItem(`${key}:clock`);
  } catch {
    /* ignore */
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
