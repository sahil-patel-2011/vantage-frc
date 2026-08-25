/**
 * Pure HTTP Range header maths for the media byte-serving route.
 * Native <video> seeking requires 206 partial responses, so the GET route
 * must honor single byte ranges (RFC 9110 §14).
 */

export type ByteRange = { start: number; end: number };

export type RangeDecision =
  | { kind: "full" }
  | { kind: "range"; range: ByteRange }
  | { kind: "unsatisfiable" };

/**
 * Parse a Range header against a known total size.
 * - No header, malformed header, non-bytes unit, or multiple ranges → "full"
 *   (RFC allows ignoring a Range header the server cannot honor).
 * - A syntactically valid range that lies wholly beyond the resource →
 *   "unsatisfiable" (serve 416 with the `bytes {asterisk}/total` Content-Range).
 * - Otherwise a clamped inclusive range for a 206 response.
 */
export function parseRangeHeader(header: string | null | undefined, totalSize: number): RangeDecision {
  if (!header || !Number.isFinite(totalSize) || totalSize <= 0) {
    return Number.isFinite(totalSize) && totalSize <= 0 && header
      ? { kind: "unsatisfiable" }
      : { kind: "full" };
  }
  const match = /^bytes=(.+)$/i.exec(header.trim());
  const specList = match?.[1];
  if (!specList) return { kind: "full" };
  const specs = specList.split(",");
  if (specs.length !== 1) return { kind: "full" };

  const spec = (specs[0] ?? "").trim();
  const parts = /^(\d*)-(\d*)$/.exec(spec);
  if (!parts) return { kind: "full" };
  const startRaw = parts[1] ?? "";
  const endRaw = parts[2] ?? "";

  if (startRaw === "" && endRaw === "") return { kind: "full" };

  // Suffix form: bytes=-N → last N bytes.
  if (startRaw === "") {
    const suffix = Number(endRaw);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    const start = Math.max(0, totalSize - suffix);
    return { kind: "range", range: { start, end: totalSize - 1 } };
  }

  const start = Number(startRaw);
  if (!Number.isSafeInteger(start) || start < 0) return { kind: "full" };
  if (start > totalSize - 1) return { kind: "unsatisfiable" };

  if (endRaw === "") {
    return { kind: "range", range: { start, end: totalSize - 1 } };
  }
  const end = Number(endRaw);
  if (!Number.isSafeInteger(end) || end < start) return { kind: "full" };
  return { kind: "range", range: { start, end: Math.min(end, totalSize - 1) } };
}

/** Inclusive-range byte count for Content-Length. */
export function rangeLength(range: ByteRange): number {
  return range.end - range.start + 1;
}

/** `Content-Range` value for a 206 response. */
export function contentRangeHeader(range: ByteRange, totalSize: number): string {
  return `bytes ${range.start}-${range.end}/${totalSize}`;
}

/** `Content-Range` value for a 416 response. */
export function unsatisfiableContentRange(totalSize: number): string {
  return `bytes */${totalSize}`;
}
