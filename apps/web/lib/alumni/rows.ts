/**
 * Pure alumni-row mapping. The directory is exactly the persisted rows — an empty
 * table is an empty list, never a seeded "DEMO classmates" network.
 */

import type { AlumniDirectory, AlumniRow, AlumniSummary, AlumniWrite } from "./types";

const PLACEHOLDER_NAME =
  /^(demo(\s+classmate)?s?|classmate\s*\d+|sample\s+alum(nus|na|ni)?)$/i;

export function isPlaceholderAlumniName(name: string): boolean {
  return PLACEHOLDER_NAME.test(name.trim());
}

function trimmedOrNull(value: unknown, max = 400): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function asIso(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

/** Graduation year as stored: 1990–2100, or null. Invalid values do not become a fake year. */
export function alumniGradYear(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1990 || n > 2100) return null;
  return n;
}

/**
 * Map one persisted row. Missing id or name means the row is unusable — drop it
 * rather than invent a classmate to fill the gap.
 */
export function mapAlumniRow(raw: Record<string, unknown> | null | undefined): AlumniRow | null {
  if (!raw) return null;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const fullName = trimmedOrNull(raw.fullName ?? raw.full_name, 200);
  const addedBy = typeof raw.addedBy === "string" ? raw.addedBy : typeof raw.added_by === "string" ? raw.added_by : "";
  if (!id || !fullName) return null;
  return {
    id,
    fullName,
    gradYear: alumniGradYear(raw.gradYear ?? raw.grad_year),
    currentRole: trimmedOrNull(raw.currentRole ?? raw.current_role, 200),
    email: trimmedOrNull(raw.email, 200),
    discordHandle: trimmedOrNull(raw.discordHandle ?? raw.discord_handle, 80),
    linkedinUrl: trimmedOrNull(raw.linkedinUrl ?? raw.linkedin_url, 300),
    note: trimmedOrNull(raw.note, 2000),
    isMentor: raw.isMentor === true || raw.is_mentor === true,
    mentorTopic: trimmedOrNull(raw.mentorTopic ?? raw.mentor_topic, 200),
    addedBy,
    createdAt: asIso(raw.createdAt ?? raw.created_at),
  };
}

/**
 * Build the directory from persisted rows only. Zero rows → empty list and zero
 * totals. Never appends DEMO classmates, sample alums, or invented mentors.
 */
export function directoryFromRows(
  rows: Array<Record<string, unknown> | null | undefined>,
  viewerId: string,
): AlumniDirectory {
  const alumni = rows.map(mapAlumniRow).filter((row): row is AlumniRow => row != null);
  return { alumni, viewerId, summary: summarizeAlumni(alumni) };
}

export function summarizeAlumni(alumni: readonly AlumniRow[]): AlumniSummary {
  return {
    total: alumni.length,
    mentors: alumni.filter((row) => row.isMentor).length,
  };
}

export class AlumniWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AlumniWriteError";
  }
}

/**
 * Validate a create payload. Rejects blank names and placeholder "DEMO classmate"
 * seeds so the table only stores people the team actually recorded.
 */
export function parseAlumniWrite(body: Record<string, unknown>): AlumniWrite {
  const fullName = trimmedOrNull(body.fullName ?? body.full_name, 200);
  if (!fullName) throw new AlumniWriteError("Name is required");
  if (isPlaceholderAlumniName(fullName)) {
    throw new AlumniWriteError("Alumni rows must be real people — DEMO classmates are not stored");
  }

  const rawYear = body.gradYear ?? body.graduationYear ?? body.grad_year;
  if (rawYear != null && rawYear !== "") {
    const parsed = alumniGradYear(rawYear);
    if (parsed == null) throw new AlumniWriteError("Graduation year looks invalid");
  }

  return {
    fullName,
    gradYear: alumniGradYear(rawYear),
    currentRole: trimmedOrNull(body.currentRole ?? body.current_role, 200),
    email: trimmedOrNull(body.email, 200),
    discordHandle: trimmedOrNull(body.discordHandle ?? body.discord_handle, 80),
    linkedinUrl: trimmedOrNull(body.linkedinUrl ?? body.linkedin_url, 300),
    note: trimmedOrNull(body.note, 2000),
    isMentor: body.isMentor === true || body.is_mentor === true,
    mentorTopic: trimmedOrNull(body.mentorTopic ?? body.mentor_topic, 200),
  };
}
