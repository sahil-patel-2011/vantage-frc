/**
 * Lead notes on a Lovat-style team lookup card. Members read; owners and
 * admins write. Empty is a setup state, not a fake quote.
 */

export const LOOKUP_NOTE_MAX_CHARS = 2000;

export type LookupNote = {
  teamKey: string;
  body: string;
  updatedAt: string | null;
  updatedBy: string | null;
  canEdit: boolean;
};

export function sanitizeLookupNote(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\r\n/g, "\n").trim().slice(0, LOOKUP_NOTE_MAX_CHARS);
}

export function lookupNoteIsEmpty(body: string | null | undefined): boolean {
  return !body || !body.trim();
}

export function lookupNotePreview(body: string, max = 160): string {
  const trimmed = body.trim();
  if (!trimmed) return "";
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

export function parseLookupNote(raw: unknown, teamKey: string, canEdit: boolean): LookupNote {
  if (!raw || typeof raw !== "object") {
    return { teamKey, body: "", updatedAt: null, updatedBy: null, canEdit };
  }
  const row = raw as Record<string, unknown>;
  return {
    teamKey,
    body: sanitizeLookupNote(row.body),
    updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : typeof row.updated_at === "string" ? row.updated_at : null,
    updatedBy: typeof row.updatedBy === "string" ? row.updatedBy : typeof row.updated_by === "string" ? row.updated_by : null,
    canEdit,
  };
}

export function lookupNoteEmptyCopy(canEdit: boolean): { title: string; detail: string } {
  return canEdit
    ? {
        title: "No note yet",
        detail: "Write what drive team should remember. This stays blank until you save a real note.",
      }
    : {
        title: "No note yet",
        detail: "A lead can add a note for this robot. Nothing is invented here.",
      };
}

export function canEditLookupNotes(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}
