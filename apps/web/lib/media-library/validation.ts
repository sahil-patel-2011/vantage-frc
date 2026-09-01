/**
 * Pure validation for media-library uploads. No DOM, no DB — unit-testable
 * in node, shared by the API routes and the client upload pipeline.
 */

import { hostedVideoCapBytes, hostedVideoOversizeMessage } from "../media/hosted-video-cap";
import {
  DB_ROW_CAP_BYTES,
  VERCEL_SAFE_UPLOAD_BYTES,
  cloudUploadCapBytes,
  type CapEnv,
} from "../storage-routing/caps";
import type { MediaKind } from "./types";

export const PHOTO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_CONTENT_TYPES = ["video/mp4", "video/webm"] as const;

/**
 * Honest caps. Photos land well under 8MB after the client-side canvas
 * downscale. Videos on the hosted cloud path are capped at 4 MiB — Vercel
 * rejects 6–100 MB bodies at the edge with 413. The schema still allows
 * 100 MB per row; that size belongs on a paired storage node, not a
 * Vercel function. The Match Video Index already handles YouTube links.
 */
export const PHOTO_DB_CAP_BYTES = 8 * 1024 * 1024;
/** Schema CHECK ceiling (0483/0489). A paired storage node can store this. */
export const VIDEO_SCHEMA_CAP_BYTES = DB_ROW_CAP_BYTES;
/**
 * Advertised cloud-path video cap. Hosted Vercel cannot accept 6–100 MB;
 * 4 MiB is what the function path actually honors. The client reads this
 * constant, so it must never be 100 MB.
 */
export const VIDEO_DB_CAP_BYTES = VERCEL_SAFE_UPLOAD_BYTES;

/** Thumbnails are tiny client-generated jpegs; keep them tiny. */
export const THUMBNAIL_CAP_BYTES = 512 * 1024;

/** Longest edge for client-generated thumbnails / video poster frames. */
export const THUMBNAIL_MAX_EDGE = 480;
export const THUMBNAIL_JPEG_QUALITY = 0.72;

export function isAllowedContentType(contentType: unknown): contentType is string {
  return (
    typeof contentType === "string" &&
    ([...PHOTO_CONTENT_TYPES, ...VIDEO_CONTENT_TYPES] as string[]).includes(contentType)
  );
}

/** Media kind implied by a container format, or null when unsupported. */
export function mediaKindForContentType(contentType: unknown): MediaKind | null {
  if (typeof contentType !== "string") return null;
  if ((PHOTO_CONTENT_TYPES as readonly string[]).includes(contentType)) return "photo";
  if ((VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) return "video";
  return null;
}

/** Schema ceiling per kind — not the hosted function cap. */
export function dbCapForKind(kind: MediaKind): number {
  return kind === "photo" ? PHOTO_DB_CAP_BYTES : VIDEO_SCHEMA_CAP_BYTES;
}

/** What the cloud (function) path will actually accept for this kind. */
export function hostedCapForKind(kind: MediaKind, env: CapEnv = process.env as CapEnv): number {
  return kind === "video"
    ? hostedVideoCapBytes(env)
    : Math.min(PHOTO_DB_CAP_BYTES, cloudUploadCapBytes(env));
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function trimmedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export type UploadMetadata = {
  kind: MediaKind;
  title: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  albumId: string | null;
  eventKey: string | null;
  subteam: string | null;
  takenAt: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
};

export type UploadValidation =
  | { ok: true; value: UploadMetadata }
  | { ok: false; error: string };

function positiveIntOrNull(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded >= 1 && rounded <= max ? rounded : null;
}

function isoTimestampOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * Validates the metadata for one upload destined for in-database storage.
 * Returns a normalized payload or a human-readable error naming real numbers.
 */
export function validateUploadMetadata(
  body: Record<string, unknown>,
  env: CapEnv = process.env as CapEnv,
): UploadValidation {
  if (!isAllowedContentType(body.contentType)) {
    return {
      ok: false,
      error:
        "Unsupported format. Photos: JPEG, PNG, or WebP. Videos: MP4 or WebM.",
    };
  }
  const kind = mediaKindForContentType(body.contentType);
  if (!kind) return { ok: false, error: "Unsupported media format." };
  if (body.kind !== undefined && body.kind !== kind) {
    return { ok: false, error: `A ${String(body.kind)} cannot use ${body.contentType}.` };
  }

  const byteSize = typeof body.byteSize === "number" ? Math.round(body.byteSize) : NaN;
  if (!Number.isFinite(byteSize) || byteSize < 1) {
    return { ok: false, error: "byteSize must be a positive number of bytes." };
  }
  const cap = hostedCapForKind(kind, env);
  if (byteSize > cap) {
    return { ok: false, error: oversizeUploadMessage(kind, byteSize, env) };
  }

  if (!isSha256Hex(body.sha256)) {
    return { ok: false, error: "sha256 must be a 64-character lowercase hex digest." };
  }

  const title = trimmedOrNull(body.title, 200);
  if (!title) return { ok: false, error: "A title is required." };

  return {
    ok: true,
    value: {
      kind,
      title,
      contentType: body.contentType,
      byteSize,
      sha256: body.sha256,
      albumId: trimmedOrNull(body.albumId, 64),
      eventKey: trimmedOrNull(body.eventKey, 40),
      subteam: trimmedOrNull(body.subteam, 60),
      takenAt: isoTimestampOrNull(body.takenAt),
      width: positiveIntOrNull(body.width, 16384),
      height: positiveIntOrNull(body.height, 16384),
      durationSeconds:
        typeof body.durationSeconds === "number" &&
        Number.isFinite(body.durationSeconds) &&
        body.durationSeconds > 0 &&
        body.durationSeconds <= 21600
          ? Math.round(body.durationSeconds * 100) / 100
          : null,
    },
  };
}

export function formatMediaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Over-cap message that always names the real size and the real cap. */
export function oversizeUploadMessage(
  kind: MediaKind,
  byteSize: number,
  env: CapEnv = process.env as CapEnv,
): string {
  const enforced = hostedCapForKind(kind, env);
  if (kind === "photo") {
    return `Photo is ${formatMediaBytes(byteSize)} — over the ${formatMediaBytes(enforced)} database cap even after downscaling.`;
  }
  // Client bundles cannot see VERCEL, so a 20 MB clip can be under the
  // env-enforced 100 MB schema ceiling and still be over the 4 MiB cloud
  // cap the UI advertises. Name the cap that actually blocks the file.
  if (byteSize > enforced) return hostedVideoOversizeMessage(byteSize, env);
  return hostedVideoOversizeMessage(byteSize, { VERCEL: "1" });
}
