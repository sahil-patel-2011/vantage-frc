/**
 * Attachment headers for the /api/export/table fallback.
 * Pure — the route does the I/O, this does the escaping that keeps a filename from
 * becoming a header-injection or path-traversal bug.
 */

/** Hard cap shared with the client fallback (see download-csv.ts). */
export const EXPORT_TABLE_MAX_BYTES = 6_000_000;

/**
 * Reduce an arbitrary caller-supplied name to a safe, always-.csv download filename.
 * Strips directories, CR/LF (header injection), quotes and anything non-ASCII.
 */
export function sanitizeCsvFileName(raw: unknown, fallback = "vantage-export.csv"): string {
  if (typeof raw !== "string") return fallback;
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .replace(/\.csv$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 96);
  return cleaned ? `${cleaned}.csv` : fallback;
}

/** RFC 6266 Content-Disposition for an already-sanitized (ASCII) filename. */
export function csvContentDisposition(fileName: string): string {
  return `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
