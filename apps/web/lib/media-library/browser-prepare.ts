// Browser-side photo preparation + upload through the media-library pipeline
// (POST /api/media-library create-item, then PUT bytes). Mirrors what the
// Media Library page does inline so other features (engineering notebook)
// reuse the same downscale/thumbnail/checksum path instead of a second
// upload route. DOM-only: never import from a server module.

import {
  DOWNSCALE_JPEG_QUALITY,
  downscaleDimensions,
  isDownscalableImageType,
} from "../scouting/media-downscale";
import {
  PHOTO_DB_CAP_BYTES,
  THUMBNAIL_JPEG_QUALITY,
  THUMBNAIL_MAX_EDGE,
  mediaKindForContentType,
  oversizeUploadMessage,
} from "./validation";

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    image.src = url;
  });
}

function drawToBlob(source: CanvasImageSource, width: number, height: number, quality: number): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export type PreparedPhoto = {
  blob: Blob;
  contentType: string;
  width: number;
  height: number;
  thumbnailBase64: string | null;
  sha256: string;
};

/** Downscale a photo via canvas, build its thumbnail, and checksum the bytes. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const image = await loadImage(file);
  const natural = { width: image.naturalWidth, height: image.naturalHeight };
  const target = downscaleDimensions(natural.width, natural.height);

  let blob: Blob = file;
  let contentType = file.type;
  let width = natural.width;
  let height = natural.height;
  if (isDownscalableImageType(file.type) && (target.scaled || file.size > PHOTO_DB_CAP_BYTES) && target.width > 0) {
    const encoded = await drawToBlob(image, target.width, target.height, DOWNSCALE_JPEG_QUALITY);
    if (encoded) {
      blob = encoded;
      contentType = "image/jpeg";
      width = target.width;
      height = target.height;
    }
  }
  if (blob.size > PHOTO_DB_CAP_BYTES) throw new Error(oversizeUploadMessage("photo", blob.size));

  let thumbnailBase64: string | null = null;
  const thumbDims = downscaleDimensions(natural.width, natural.height, THUMBNAIL_MAX_EDGE);
  if (thumbDims.width > 0) {
    const thumb = await drawToBlob(image, thumbDims.width, thumbDims.height, THUMBNAIL_JPEG_QUALITY);
    if (thumb) thumbnailBase64 = await blobToBase64(thumb);
  }
  const sha256 = await sha256Hex(await blob.arrayBuffer());
  return { blob, contentType, width, height, thumbnailBase64, sha256 };
}

export function defaultMediaTitle(fileName: string): string {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  return (base || fileName || "Untitled").slice(0, 200);
}

/**
 * Register + upload one photo into the org's media library. Returns the
 * media_items id (an existing id when the same bytes were already uploaded).
 */
export async function uploadPhotoToLibrary(input: {
  orgId: string;
  file: File;
  title?: string;
  subteam?: string | null;
}): Promise<{ itemId: string; duplicate: boolean }> {
  if (mediaKindForContentType(input.file.type) !== "photo") {
    throw new Error("Only JPEG, PNG, or WebP photos can be attached.");
  }
  const prepared = await preparePhoto(input.file);
  const register = await fetch("/api/media-library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      action: "create-item",
      orgId: input.orgId,
      contentType: prepared.contentType,
      byteSize: prepared.blob.size,
      sha256: prepared.sha256,
      title: input.title ?? defaultMediaTitle(input.file.name),
      subteam: input.subteam ?? null,
      takenAt: input.file.lastModified ? new Date(input.file.lastModified).toISOString() : null,
      width: prepared.width,
      height: prepared.height,
      thumbnailBase64: prepared.thumbnailBase64,
    }),
  });
  const created = (await register.json()) as { itemId?: string; duplicate?: boolean; uploadUrl?: string | null; error?: string };
  if (!register.ok || !created.itemId) throw new Error(created.error ?? "Could not register the upload.");
  if (created.duplicate) return { itemId: created.itemId, duplicate: true };
  const put = await fetch(String(created.uploadUrl), { method: "PUT", body: prepared.blob });
  if (!put.ok) {
    const payload = (await put.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? "Upload failed.");
  }
  return { itemId: created.itemId, duplicate: false };
}
