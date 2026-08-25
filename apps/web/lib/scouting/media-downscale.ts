/**
 * Pure geometry + size-limit helpers for scout media downscaling.
 * No canvas / DOM here — the actual canvas re-encode lives in the client
 * component so this stays unit-testable in node.
 */

/** Longest edge after client-side downscale. Phone photos land ~1600px. */
export const DOWNSCALE_MAX_EDGE = 1600;

/** JPEG re-encode quality for downscaled scout photos. */
export const DOWNSCALE_JPEG_QUALITY = 0.82;

/**
 * Server-side upload cap. Mirrors MAX_SCOUT_MEDIA_BYTES in
 * app/api/scouting/media/[clientId]/route.ts — anything above this is
 * rejected by the PUT endpoint, so the client must never queue it as-is.
 */
export const MAX_SCOUT_MEDIA_BYTES = 6 * 1024 * 1024;

export type DownscaleDimensions = {
  width: number;
  height: number;
  /** True when the source exceeded maxEdge and was shrunk. */
  scaled: boolean;
};

/**
 * Target dimensions for an image so its longest edge is at most `maxEdge`,
 * preserving aspect ratio. Never upscales. Invalid input collapses to 0x0.
 */
export function downscaleDimensions(
  width: number,
  height: number,
  maxEdge: number = DOWNSCALE_MAX_EDGE,
): DownscaleDimensions {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(maxEdge) ||
    maxEdge <= 0
  ) {
    return { width: 0, height: 0, scaled: false };
  }
  const longEdge = Math.max(width, height);
  if (longEdge <= maxEdge) {
    return { width: Math.round(width), height: Math.round(height), scaled: false };
  }
  const ratio = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  };
}

/**
 * Only raster stills are safe to re-encode through a canvas. GIFs lose
 * animation and SVGs are tiny anyway; videos/audio are never downscaled here.
 */
export function isDownscalableImageType(contentType: string | null | undefined): boolean {
  if (!contentType || !contentType.startsWith("image/")) return false;
  return contentType !== "image/gif" && contentType !== "image/svg+xml";
}

/** Human-readable size for quarantine reasons ("8.4 MB", "412 KB", "96 B"). */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function exceedsMediaCap(bytes: number, cap: number = MAX_SCOUT_MEDIA_BYTES): boolean {
  return Number.isFinite(bytes) && bytes > cap;
}

/** Quarantine reason for an over-cap file — always names the actual size. */
export function oversizeMediaReason(
  bytes: number,
  kindLabel = "File",
  cap: number = MAX_SCOUT_MEDIA_BYTES,
): string {
  return `${kindLabel} is ${formatByteSize(bytes)} — over the ${formatByteSize(cap)} upload limit. Retake or trim it, then retry.`;
}

/** UI label for a queued media kind ("photo" → "Photo"). */
export function mediaKindLabel(kind: unknown): string {
  if (kind === "photo") return "Photo";
  if (kind === "video") return "Video";
  if (kind === "audio") return "Audio clip";
  return "File";
}
