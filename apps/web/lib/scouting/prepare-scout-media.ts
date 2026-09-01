// The client-side cap already mirrors the server PUT cap in media-downscale.ts; reuse it rather
// than minting a second constant that can drift from app/api/scouting/media/[clientId]/route.ts.
import { cloudUploadCapBytes, type CapEnv } from "../storage-routing/caps";
import {
  DOWNSCALE_JPEG_QUALITY,
  DOWNSCALE_MAX_EDGE,
  MAX_SCOUT_MEDIA_BYTES,
  downscaleDimensions,
  formatByteSize,
} from "./media-downscale";

export { MAX_SCOUT_MEDIA_BYTES };

/**
 * Honest scout PUT cap for THIS deployment. The historical 6 MB constant sits
 * above Vercel's 4.5 MB function body limit; on hosted cloud we refuse at 4 MiB
 * so the platform never answers with 413 FUNCTION_PAYLOAD_TOO_LARGE.
 */
export function hostedScoutMediaCapBytes(env: CapEnv = process.env as CapEnv): number {
  return Math.min(MAX_SCOUT_MEDIA_BYTES, cloudUploadCapBytes(env));
}

/** True when a scout PUT body is empty or over the hosted cap. */
export function scoutMediaExceedsHostedCap(
  byteLength: number,
  env: CapEnv = process.env as CapEnv,
): boolean {
  return !Number.isFinite(byteLength) || byteLength < 1 || byteLength > hostedScoutMediaCapBytes(env);
}

/**
 * JSON body for a 400 so the scout PUT can refuse above the hosted cap
 * instead of reading a 6 MB body that Vercel already 413'd at the edge.
 */
export function scoutMediaPutByteLimitError(
  byteLength: number,
  env: CapEnv = process.env as CapEnv,
): { error: string } | null {
  if (!scoutMediaExceedsHostedCap(byteLength, env)) return null;
  return { error: `Media must be between 1 byte and ${hostedScoutMediaCapBytes(env)} bytes` };
}

/** Longest edge for a pit-photo thumb — small enough for a 72px chip without the 6MB original. */
export const SCOUT_MEDIA_THUMB_EDGE = 320;

/** JPEG quality for the client-generated thumb. Kept tiny on purpose. */
export const SCOUT_MEDIA_THUMB_JPEG_QUALITY = 0.72;

/** Names the actual cap so the scout knows what "too big" means before retaking. */
export function scoutMediaOversizeMessage(maxBytes: number = MAX_SCOUT_MEDIA_BYTES): string {
  return `That file is over the ${formatByteSize(maxBytes)} upload limit. Retake or trim it, then try again.`;
}

/** Media kinds scout_media accepts (see the enum in 0003 plus audio in /api/scouting/media). */
export type ScoutMediaKind = "photo" | "video" | "audio";

/**
 * The pit/match entry this capture belongs to. `entryClientId` is required — without it the
 * photo is an orphan and strategy/dossier counts stay at zero. `entryId` is the server uuid
 * once the entry has synced; it is optional at capture time.
 */
export type ScoutMediaEntryLink = {
  entryClientId: string;
  entryId: string | null;
};

/** Metadata the media outbox POSTs to /api/scouting/media. Always carries the entry link. */
export type ScoutMediaUploadMetadata = {
  eventKey: string;
  teamKey: string;
  kind: ScoutMediaKind;
  contentType: string;
  byteSize: number;
  tags: string[];
  entryClientId: string;
  entryId: string | null;
  fieldKey?: string;
  hasThumb: boolean;
  thumbContentType: string | null;
  thumbByteSize: number | null;
};

export type PreparedScoutPitPhoto = {
  file: File;
  thumb: File | null;
  kind: ScoutMediaKind;
  metadata: Omit<ScoutMediaUploadMetadata, "eventKey" | "teamKey" | "tags" | "fieldKey">;
};

/**
 * Permanent failure: a retry cannot fix the file itself, so the caller must quarantine it with a
 * discard action instead of leaving it to spin in the upload outbox.
 */
export class PermanentScoutMediaError extends Error {
  readonly permanent = true as const;

  constructor(message: string) {
    super(message);
    this.name = "PermanentScoutMediaError";
  }
}

export function isPermanentScoutMediaError(error: unknown): boolean {
  return error instanceof PermanentScoutMediaError;
}

export function scoutMediaUnsupportedMessage(file: { type?: string; name?: string }): string {
  const label = file.type?.trim() || (file.name?.includes(".") ? file.name.split(".").pop() : "") || "that file";
  return `${label} is not a photo, video or audio clip — scout media only accepts those. Discard it and retake.`;
}

/** Pit photos cannot be queued as orphans — that is what left entry_id NULL historically. */
export function scoutMediaUnlinkedMessage(): string {
  return "Pit photos must be attached to an entry before they can be queued.";
}

function isHeicLike(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type.includes("heic") ||
    type.includes("heif") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

function canUseCanvas(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof document !== "undefined" &&
    typeof document.createElement === "function"
  );
}

async function blobFromCanvas(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

/** Decode with EXIF orientation when the browser supports it so portrait phone photos stay upright. */
async function bitmapFromFile(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return await createImageBitmap(file);
  }
}

async function encodeJpegAtEdge(
  file: File,
  maxEdge: number,
  qualities: readonly number[],
  maxBytes: number,
): Promise<File> {
  const bitmap = await bitmapFromFile(file);
  try {
    const { width, height } = downscaleDimensions(bitmap.width, bitmap.height, maxEdge);
    if (width < 1 || height < 1) throw new Error("Could not prepare the photo");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the photo");
    ctx.drawImage(bitmap, 0, 0, width, height);
    for (const quality of qualities) {
      const blob = await blobFromCanvas(canvas, quality);
      if (blob && blob.size <= maxBytes) {
        return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", {
          type: "image/jpeg",
        });
      }
    }
    throw new PermanentScoutMediaError(scoutMediaOversizeMessage(maxBytes));
  } finally {
    bitmap.close();
  }
}

async function compressImageToJpeg(file: File, maxBytes: number): Promise<File> {
  return encodeJpegAtEdge(
    file,
    DOWNSCALE_MAX_EDGE,
    [DOWNSCALE_JPEG_QUALITY, 0.7, 0.55, 0.4, 0.32],
    maxBytes,
  );
}

/** Which scout_media kind a captured file belongs to; typeless files are treated as photos. */
export function scoutMediaKind(file: { type?: string; name?: string }): ScoutMediaKind {
  const type = (file.type ?? "").toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return "photo";
}

function isImageLike(file: File): boolean {
  return file.type.startsWith("image/") || isHeicLike(file) || !file.type;
}

/** Target size for a pit-photo thumb. Never upscales. Invalid input is 0×0. */
export function scoutMediaThumbDimensions(width: number, height: number) {
  return downscaleDimensions(width, height, SCOUT_MEDIA_THUMB_EDGE);
}

/**
 * Client-side thumb for a still. Returns null honestly when the file is not an image or the
 * browser cannot decode it — never a DEMO/placeholder jpeg.
 */
export async function prepareScoutMediaThumb(file: File): Promise<File | null> {
  if (!file.size || !isImageLike(file)) return null;
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) return null;
  if (!canUseCanvas()) return null;
  try {
    const thumb = await encodeJpegAtEdge(
      file,
      SCOUT_MEDIA_THUMB_EDGE,
      [SCOUT_MEDIA_THUMB_JPEG_QUALITY, 0.6, 0.48],
      MAX_SCOUT_MEDIA_BYTES,
    );
    return thumb.size > 0 ? thumb : null;
  } catch {
    return null;
  }
}

/**
 * Refuse to treat a capture as linked unless the entry's client id is present. An empty
 * entryClientId is how scout_media.entry_id historically stayed NULL.
 */
export function requireScoutMediaEntryLink(link: {
  entryClientId?: string | null;
  entryId?: string | null;
}): ScoutMediaEntryLink {
  const entryClientId = typeof link.entryClientId === "string" ? link.entryClientId.trim() : "";
  if (!entryClientId) {
    throw new PermanentScoutMediaError(scoutMediaUnlinkedMessage());
  }
  const entryId = typeof link.entryId === "string" ? link.entryId.trim() : "";
  return { entryClientId, entryId: entryId || null };
}

/**
 * Build the outbox metadata POST body. Always includes entryClientId (and entryId when known)
 * so /api/scouting/media can write scout_media.entry_id instead of leaving it NULL.
 */
export function buildScoutMediaMetadata(input: {
  eventKey: string;
  teamKey: string;
  kind: ScoutMediaKind;
  contentType: string;
  byteSize: number;
  tags?: readonly string[];
  fieldKey?: string;
  entryClientId: string;
  entryId?: string | null;
  hasThumb?: boolean;
  thumbContentType?: string | null;
  thumbByteSize?: number | null;
}): ScoutMediaUploadMetadata {
  const link = requireScoutMediaEntryLink(input);
  const tags = [...(input.tags ?? [])];
  if (input.fieldKey) {
    const fieldTag = `field:${input.fieldKey}`;
    if (!tags.includes(fieldTag)) tags.push(fieldTag);
    if (!tags.includes("robot_image")) tags.push("robot_image");
  }
  return {
    eventKey: input.eventKey,
    teamKey: input.teamKey,
    kind: input.kind,
    contentType: input.contentType,
    byteSize: input.byteSize,
    tags,
    entryClientId: link.entryClientId,
    entryId: link.entryId,
    fieldKey: input.fieldKey,
    hasThumb: Boolean(input.hasThumb),
    thumbContentType: input.thumbContentType ?? null,
    thumbByteSize: input.thumbByteSize ?? null,
  };
}

/**
 * The last gate before a captured file enters the IndexedDB outbox.
 *
 * Keeps pit/robot photos under the server PUT cap (canvas re-encode, including HEIC from iOS).
 * Videos and audio over the cap are refused rather than transcoded, unsupported types are refused
 * outright, and empty files never get queued. Every refusal is a PermanentScoutMediaError so the
 * caller quarantines with a discard action instead of retrying forever against a 400.
 */
export async function prepareScoutMediaFile(file: File): Promise<File> {
  if (!file.size) throw new PermanentScoutMediaError("That file is empty.");
  const imageLike = isImageLike(file);
  if (file.type.startsWith("video/") || file.type.startsWith("audio/")) {
    if (file.size > MAX_SCOUT_MEDIA_BYTES) {
      throw new PermanentScoutMediaError(scoutMediaOversizeMessage());
    }
    return file;
  }
  if (!imageLike) throw new PermanentScoutMediaError(scoutMediaUnsupportedMessage(file));
  if (file.size <= MAX_SCOUT_MEDIA_BYTES && !isHeicLike(file) && file.type.startsWith("image/")) {
    return file;
  }
  if (canUseCanvas()) {
    try {
      return await compressImageToJpeg(file, MAX_SCOUT_MEDIA_BYTES);
    } catch (error) {
      if (isPermanentScoutMediaError(error)) throw error;
      if (file.size > MAX_SCOUT_MEDIA_BYTES) {
        throw new PermanentScoutMediaError(scoutMediaOversizeMessage());
      }
      // Decode failed on a within-cap image: not permanent, the same file may decode elsewhere.
      throw error instanceof Error ? error : new Error("Could not prepare the photo");
    }
  }
  if (file.size > MAX_SCOUT_MEDIA_BYTES) {
    throw new PermanentScoutMediaError(scoutMediaOversizeMessage());
  }
  return file;
}

/**
 * Prepare a pit/robot photo for the outbox: cap the file, produce a thumb when the browser
 * can, and refuse to proceed without an entry link. Thumb is null (not a DEMO jpeg) when
 * encode is unavailable — video/audio never get a fabricated poster frame.
 */
export async function prepareScoutPitPhoto(
  file: File,
  link: { entryClientId?: string | null; entryId?: string | null },
): Promise<PreparedScoutPitPhoto> {
  const resolved = requireScoutMediaEntryLink(link);
  const prepared = await prepareScoutMediaFile(file);
  const kind = scoutMediaKind(prepared);
  const thumb = kind === "photo" ? await prepareScoutMediaThumb(prepared) : null;
  return {
    file: prepared,
    thumb,
    kind,
    metadata: {
      kind,
      contentType: prepared.type || file.type || "image/jpeg",
      byteSize: prepared.size,
      entryClientId: resolved.entryClientId,
      entryId: resolved.entryId,
      hasThumb: Boolean(thumb),
      thumbContentType: thumb?.type ?? null,
      thumbByteSize: thumb?.size ?? null,
    },
  };
}
