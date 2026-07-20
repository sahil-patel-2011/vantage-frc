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
  orgId: string;
  eventKey: string;
  entryType: "match" | "pit";
  matchKey?: string;
  teamKey: string;
}): string | null {
  const orgId = input.orgId.trim();
  const eventKey = input.eventKey.trim();
  const teamKey = input.teamKey.trim();
  if (!orgId || !eventKey || !teamKey) return null;
  const matchPart = input.entryType === "match" ? (input.matchKey?.trim() || "_") : "pit";
  return `vantage-scout-draft:${orgId}:${eventKey}:${input.entryType}:${matchPart}:${teamKey}`;
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
  } catch {
    /* ignore */
  }
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
