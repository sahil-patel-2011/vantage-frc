/**
 * Pure validation for Team Library resources. No DOM, no DB — unit-testable
 * in node, shared by the API routes and the client upload pipeline.
 *
 * Deliberately NO file-type allowlist: the library holds CAD (STEP/DXF/F3D/
 * SLDPRT), PDFs, manuals, images, zips, code — anything within the size cap.
 * The only sanity rules are "not empty" and "fits the honest database cap".
 */

import { formatMediaBytes, isSha256Hex, trimmedOrNull } from "../media-library/validation";
import type { LibraryVisibility } from "./types";

export { formatMediaBytes as formatLibraryBytes, isSha256Hex, trimmedOrNull };

/**
 * Honest in-database cap, matching the media-library video cap (bytea rows
 * are real database storage). Bigger files belong on a paired storage node.
 */
export const LIBRARY_DB_CAP_BYTES = 100 * 1024 * 1024;

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;
export const MAX_URL_LENGTH = 2048;
export const MAX_NOTES_LENGTH = 4000;

/** Strip parameters/whitespace; fall back to octet-stream so ANY file uploads. */
export function normalizeContentType(value: unknown): string {
  if (typeof value !== "string") return "application/octet-stream";
  const bare = value.split(";")[0]!.trim().toLowerCase();
  if (bare.length < 3 || bare.length > 255 || !/^\S+\/\S+$/.test(bare)) {
    return "application/octet-stream";
  }
  return bare;
}

/** Keep the original name (it carries the extension) but never a path. */
export function sanitizeFileName(value: unknown): string {
  if (typeof value !== "string") return "file";
  const base = value.split(/[\\/]/).pop() ?? "";
  const trimmed = base.trim().slice(0, 255);
  return trimmed || "file";
}

/** "swerve-module.step" -> "swerve-module" (falls back to the full name). */
export function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return (base.trim() || fileName).slice(0, 200);
}

export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const tag = entry.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

/** "tag1, tag2" -> normalized array (client convenience, tested here). */
export function parseTagInput(value: string): string[] {
  return normalizeTags(value.split(/[,\n]/));
}

export function normalizeVisibility(value: unknown): LibraryVisibility {
  return value === "restricted" ? "restricted" : "team";
}

/** Ids for restricted-sharing grants: trimmed, deduped, capped. */
export function normalizeGrantUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of value) {
    const id = trimmedOrNull(entry, 64);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 200) break;
  }
  return ids;
}

export type LinkValidation =
  | { ok: true; value: { title: string; url: string; notes: string | null } }
  | { ok: false; error: string };

/** Validates an external link (standalone resource or attached to a file). */
export function validateLinkInput(body: Record<string, unknown>): LinkValidation {
  const rawUrl = trimmedOrNull(body.url, MAX_URL_LENGTH);
  if (!rawUrl) return { ok: false, error: "A link URL is required." };
  if (!/^https?:\/\//i.test(rawUrl)) {
    return { ok: false, error: "Links must start with http:// or https://." };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "That URL could not be parsed." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Links must start with http:// or https://." };
  }
  const title = trimmedOrNull(body.title, 200) ?? trimmedOrNull(parsed.hostname, 200);
  if (!title) return { ok: false, error: "A link title is required." };
  return {
    ok: true,
    value: { title, url: rawUrl, notes: trimmedOrNull(body.notes, 1000) },
  };
}

export type FileMetadata = {
  title: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  folderId: string | null;
  notes: string | null;
  tags: string[];
  visibility: LibraryVisibility;
  grantUserIds: string[];
};

export type FileValidation =
  | { ok: true; value: FileMetadata }
  | { ok: false; error: string };

/**
 * Validates the metadata for one upload destined for in-database storage.
 * Any content type passes; only emptiness and the size cap are enforced.
 */
export function validateFileMetadata(body: Record<string, unknown>): FileValidation {
  const fileName = sanitizeFileName(body.fileName);
  const byteSize = typeof body.byteSize === "number" ? Math.round(body.byteSize) : NaN;
  if (!Number.isFinite(byteSize) || byteSize < 1) {
    return { ok: false, error: "Empty files cannot be uploaded." };
  }
  if (byteSize > LIBRARY_DB_CAP_BYTES) {
    return { ok: false, error: oversizeFileMessage(byteSize) };
  }
  if (!isSha256Hex(body.sha256)) {
    return { ok: false, error: "sha256 must be a 64-character lowercase hex digest." };
  }
  const title = trimmedOrNull(body.title, 200) ?? titleFromFileName(fileName);
  if (!title) return { ok: false, error: "A title is required." };

  const visibility = normalizeVisibility(body.visibility);
  return {
    ok: true,
    value: {
      title,
      fileName,
      contentType: normalizeContentType(body.contentType),
      byteSize,
      sha256: body.sha256,
      folderId: trimmedOrNull(body.folderId, 64),
      notes: trimmedOrNull(body.notes, MAX_NOTES_LENGTH),
      tags: normalizeTags(body.tags),
      visibility,
      grantUserIds: visibility === "restricted" ? normalizeGrantUserIds(body.grantUserIds) : [],
    },
  };
}

/** Over-cap message that always names the real size and the real cap. */
export function oversizeFileMessage(byteSize: number): string {
  return `File is ${formatMediaBytes(byteSize)} — over the ${formatMediaBytes(LIBRARY_DB_CAP_BYTES)} database cap. Bigger files belong on a paired storage node.`;
}

/**
 * Content-Disposition for serving library bytes. ASCII fallback plus RFC 5987
 * filename* so STEP files named in any language download intact.
 */
export function contentDispositionFor(fileName: string, inline: boolean): string {
  const safe = sanitizeFileName(fileName);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(safe).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  const kind = inline ? "inline" : "attachment";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** Images preview inline in the browser; everything else is a download card. */
export function isInlinePreviewable(contentType: string | null): boolean {
  if (!contentType) return false;
  if (!contentType.startsWith("image/")) return false;
  // SVG can carry scripts — always download it rather than render it.
  return !contentType.includes("svg");
}
