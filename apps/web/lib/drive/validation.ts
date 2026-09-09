/**
 * Vantage Drive input validation and scope rules. Pure and client-safe, so the
 * page can pre-check what the API is going to enforce and the two never
 * disagree.
 *
 * The scope rules here mirror the RLS policies in migration 0641. RLS is the
 * security model — these functions exist so the UI can explain a refusal in a
 * sentence rather than showing a 403, and so the rules are unit-testable
 * without a database.
 */

import type { DriveScope } from "./types";

/** A share token is 32 lowercase hex characters: 16 bytes of randomness. */
export const DRIVE_SHARE_TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export function isDriveShareToken(value: unknown): value is string {
  return typeof value === "string" && DRIVE_SHARE_TOKEN_PATTERN.test(value);
}

export function isDriveScope(value: unknown): value is DriveScope {
  return value === "team" || value === "personal";
}

/**
 * Make a file or folder name safe to store and to show.
 *
 * Path separators are stripped because a browser's `webkitRelativePath` and a
 * drag-dropped folder both hand us "subdir/file.stl" — we keep the leaf and
 * put the structure in real folder rows instead. Control characters go because
 * they render as nothing and make two different files look identical.
 * Returns "" when nothing usable is left; callers reject that.
 */
export function sanitizeDriveName(value: unknown, maxLength = 255): string {
  if (typeof value !== "string") return "";
  const leaf = value.split(/[\\/]/).pop() ?? "";
  return leaf
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Content type is free text by design: a team's .f3z, .kicad_pcb or .dxf is a
 * real file, and an allowlist would reject exactly the formats FRC teams
 * exchange. It is normalized and length-capped, never executed, and never
 * used to decide whether to render something as HTML.
 */
export function normalizeDriveContentType(value: unknown): string {
  if (typeof value !== "string") return "application/octet-stream";
  const first = value.split(";")[0] ?? "";
  const cleaned = first.trim().toLowerCase().slice(0, 255);
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(cleaned) ? cleaned : "application/octet-stream";
}

/**
 * Content types we are willing to render inline in a preview pane. Anything
 * not on this list is offered as a download instead of being handed to the
 * browser to interpret — an uploaded .html or .svg rendered inline on our own
 * origin would be stored XSS.
 */
export function drivePreviewKind(
  contentType: string,
): "image" | "video" | "audio" | "pdf" | "text" | null {
  const type = normalizeDriveContentType(contentType);
  if (type === "image/svg+xml") return null;
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type === "application/pdf") return "pdf";
  if (type === "text/plain" || type === "text/csv" || type === "text/markdown") return "text";
  return null;
}

/** Lowercase + trim one address; returns "" when it is not plausibly an email. */
export function normalizeShareEmail(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().toLowerCase().slice(0, 320);
  if (!/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(cleaned)) return "";
  return cleaned;
}

/** Split a comma/semicolon/whitespace separated list into unique valid addresses. */
export function parseShareEmails(value: unknown, max = 25): { emails: string[]; rejected: string[] } {
  if (typeof value !== "string") return { emails: [], rejected: [] };
  const emails: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/[,;\s]+/)) {
    if (!raw.trim()) continue;
    const normalized = normalizeShareEmail(raw);
    if (!normalized) {
      rejected.push(raw.trim().slice(0, 120));
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (emails.length < max) emails.push(normalized);
    else rejected.push(normalized);
  }
  return { emails, rejected };
}

export type DriveActor = {
  userId: string;
  role: "owner" | "admin" | "scout" | "viewer" | string;
};

export type DriveRow = {
  scope: DriveScope;
  /** The personal owner, or null for team rows. */
  ownerUserId: string | null;
  /** Uploader (files) or creator (folders). */
  authorUserId: string;
};

function isLead(actor: DriveActor): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

/**
 * May this member READ the row? Mirrors the SELECT policies.
 *
 * Note what is deliberately absent: there is no lead branch on the personal
 * side. A team owner reading a student's personal file is not a feature that
 * exists here, and the page says so in plain words rather than leaving people
 * to guess.
 */
export function canReadDriveRow(row: DriveRow, actor: DriveActor): boolean {
  if (row.scope === "team") return true;
  return row.ownerUserId === actor.userId;
}

/** May this member rename, move, delete or restore the row? */
export function canManageDriveRow(row: DriveRow, actor: DriveActor): boolean {
  if (row.scope === "personal") return row.ownerUserId === actor.userId;
  return row.authorUserId === actor.userId || isLead(actor);
}

/** May this member create a share on the row? Same answer as managing it. */
export function canShareDriveRow(row: DriveRow, actor: DriveActor): boolean {
  return canManageDriveRow(row, actor);
}

/**
 * The row a new upload should carry for a given scope. Personal rows must name
 * their owner; team rows must not, so "who may read this" is decidable from
 * the row alone.
 */
export function ownerForScope(scope: DriveScope, userId: string): string | null {
  return scope === "personal" ? userId : null;
}

/** Human-readable size. Mirrors formatBytes in lib/storage-node for one voice. */
export function formatDriveBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
