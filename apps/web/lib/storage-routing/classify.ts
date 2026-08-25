/**
 * Content classification for storage routing. Pure and client-safe: the same
 * function runs in the upload UI (pre-upload plan) and in the API routes
 * (server-side decision), so the user is never shown one class and routed by
 * another.
 */

import type { StorageContentClass } from "./types";

/** CAD formats FRC teams actually exchange (mirrors the library's no-allowlist spirit). */
const CAD_EXTENSIONS = new Set([
  "step", "stp", "iges", "igs", "sldprt", "sldasm", "slddrw",
  "f3d", "f3z", "ipt", "iam", "idw", "x_t", "x_b", "sat", "3dm",
  "stl", "3mf", "obj", "dxf", "dwg", "prt", "catpart", "catproduct",
]);

const ARCHIVE_EXTENSIONS = new Set(["zip", "7z", "rar", "tar", "gz", "tgz", "bz2", "xz"]);

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "avi", "mkv", "m4v", "wmv", "mts", "m2ts"]);

const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "tif", "tiff", "bmp", "raw", "dng", "cr2", "nef", "arw"]);

export function fileExtensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Classify a file by content type first, extension second. Anything
 * unrecognized is 'other' — never guessed into a special class.
 */
export function contentClassFor(fileName: string, contentType: string | null): StorageContentClass {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "photo";
  if (
    type === "application/zip" ||
    type === "application/x-7z-compressed" ||
    type === "application/x-rar-compressed" ||
    type === "application/x-tar" ||
    type === "application/gzip"
  ) {
    return "archive";
  }
  if (type === "application/pdf" || type.startsWith("text/")) return "document";

  const ext = fileExtensionOf(fileName);
  if (CAD_EXTENSIONS.has(ext)) return "cad";
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (IMAGE_EXTENSIONS.has(ext)) return "photo";
  if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "md", "txt", "csv"].includes(ext)) {
    return "document";
  }
  return "other";
}
