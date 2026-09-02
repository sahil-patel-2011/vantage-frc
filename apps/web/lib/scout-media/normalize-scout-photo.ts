/**
 * Server-side normalization for pit / robot photos (server only — imports sharp).
 *
 * Every accepted photo becomes: EXIF-oriented, metadata-stripped WebP whose long
 * edge fits inside SCOUT_PHOTO_MAX_EDGE, plus a small WebP thumbnail, plus a
 * sha256 over the normalized full so byte-identical retakes dedupe per team.
 *
 * Client helpers that must stay sharp-free live in ./client.ts.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import { sponsorImageKind } from "../sponsor-assets";

/** Mirrors the client cap in lib/scouting/media-downscale.ts (MAX_SCOUT_MEDIA_BYTES). */
export const MAX_SCOUT_PHOTO_INPUT_BYTES = 6 * 1024 * 1024;
/** Long edge of the stored full-size photo. */
export const SCOUT_PHOTO_MAX_EDGE = 1600;
/** Long edge of the stored thumbnail. */
export const SCOUT_PHOTO_THUMB_EDGE = 320;
/** Decode bomb guard — a 40 MP frame is already far beyond any pit photo. */
export const SCOUT_PHOTO_INPUT_PIXEL_LIMIT = 40_000_000;
export const SCOUT_PHOTO_CONTENT_TYPE = "image/webp" as const;
const FULL_WEBP_QUALITY = 82;
const THUMB_WEBP_QUALITY = 72;

export type ScoutPhotoErrorCode = "empty" | "too_large" | "not_image" | "decode_failed";

/** Typed rejection so the route can map codes to 400 / 413 / 415. */
export class ScoutPhotoError extends Error {
  constructor(
    readonly code: ScoutPhotoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ScoutPhotoError";
  }
}

export type NormalizedScoutPhoto = {
  full: Buffer;
  contentType: typeof SCOUT_PHOTO_CONTENT_TYPE;
  width: number;
  height: number;
  byteSize: number;
  thumb: Buffer;
  thumbContentType: typeof SCOUT_PHOTO_CONTENT_TYPE;
  thumbWidth: number;
  thumbHeight: number;
  /** sha256 hex over `full` — the dedupe key. */
  checksumSha256: string;
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Sniff + normalize. Throws ScoutPhotoError for anything that is not a
 * PNG / JPEG / WebP raster within the input cap.
 */
export async function normalizeScoutPhoto(
  raw: Buffer | Uint8Array,
  options?: { maxEdge?: number; thumbEdge?: number; maxInputBytes?: number },
): Promise<NormalizedScoutPhoto> {
  const maxEdge = options?.maxEdge ?? SCOUT_PHOTO_MAX_EDGE;
  const thumbEdge = options?.thumbEdge ?? SCOUT_PHOTO_THUMB_EDGE;
  const maxInputBytes = options?.maxInputBytes ?? MAX_SCOUT_PHOTO_INPUT_BYTES;
  const input = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);

  if (!input.byteLength) throw new ScoutPhotoError("empty", "Photo upload was empty.");
  if (input.byteLength > maxInputBytes) {
    throw new ScoutPhotoError(
      "too_large",
      `Photo is ${(input.byteLength / (1024 * 1024)).toFixed(1)} MB — over the ${Math.round(maxInputBytes / (1024 * 1024))} MB upload limit.`,
    );
  }
  // The browser-declared content type is not evidence — sniff the bytes.
  if (!sponsorImageKind(input)) {
    throw new ScoutPhotoError(
      "not_image",
      "Upload a JPEG, PNG, or WebP photo — this file is not a supported image.",
    );
  }

  let full: Buffer;
  let width: number;
  let height: number;
  try {
    // .rotate() with no args applies the EXIF orientation and, because we do
    // not call withMetadata(), the output carries no EXIF / GPS at all.
    const result = await sharp(input, { limitInputPixels: SCOUT_PHOTO_INPUT_PIXEL_LIMIT, animated: false })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .webp({ quality: FULL_WEBP_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true });
    full = result.data;
    width = result.info.width;
    height = result.info.height;
  } catch (error) {
    throw new ScoutPhotoError(
      "decode_failed",
      error instanceof Error && /pixel limit|exceeds/i.test(error.message)
        ? "Photo has too many pixels to process — retake at a normal phone resolution."
        : "Photo could not be decoded. Retake it and try again.",
    );
  }

  const thumbResult = await sharp(full)
    .resize({ width: thumbEdge, height: thumbEdge, fit: "inside", withoutEnlargement: true })
    .webp({ quality: THUMB_WEBP_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    full,
    contentType: SCOUT_PHOTO_CONTENT_TYPE,
    width,
    height,
    byteSize: full.byteLength,
    thumb: thumbResult.data,
    thumbContentType: SCOUT_PHOTO_CONTENT_TYPE,
    thumbWidth: thumbResult.info.width,
    thumbHeight: thumbResult.info.height,
    checksumSha256: sha256Hex(full),
  };
}

/** HTTP status for a ScoutPhotoError — 415 for non-images, 413 over cap, else 400. */
export function scoutPhotoErrorStatus(error: ScoutPhotoError): 400 | 413 | 415 {
  if (error.code === "not_image") return 415;
  if (error.code === "too_large") return 413;
  return 400;
}
