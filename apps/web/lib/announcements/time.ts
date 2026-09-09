/**
 * Postgres timestamptz text is not ISO 8601.
 *
 * `created_at::text` renders as `2026-09-09 01:23:45.123456-04`: a space
 * separator and a TWO-digit UTC offset. `new Date()` rejects both, returning
 * Invalid Date — which is how every announcement shipped with an empty
 * timestamp. Normalise before parsing.
 *
 * Kept in its own module rather than inside the client component so it can be
 * unit tested without pulling React and CSS into the test run.
 */
export function toIsoInstant(raw: string): string {
  return raw
    .trim()
    .replace(" ", "T")
    // `-04` -> `-04:00`. Only a bare two-digit offset at the very end is
    // padded, so `-04:00` and a trailing `Z` are both left alone.
    .replace(/([+-]\d{2})$/, "$1:00");
}

/** Local-format an instant, or "" when the value cannot be parsed. */
export function formatInstant(raw: string): string {
  const date = new Date(toIsoInstant(raw));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
