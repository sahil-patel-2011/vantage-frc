/**
 * Read a number that might not be there.
 *
 * `Number(null)` is 0, and `Number("")` is 0. That is the single most
 * expensive fact about JavaScript in a product that shows numbers to people,
 * because it turns "nobody has worked this out yet" into a confident zero.
 *
 * It did exactly that on the dashboard: with no stored prediction for the next
 * match, the widget coerced a null probability to 0 and told the drive team
 * "0% chance we win · typical range 0–0%". A missing prediction has to render
 * as a missing prediction, and nothing else.
 */
export function numericOrNull(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    // Trim first: Number("   ") is 0 as surely as Number("") is, so a field
    // containing only spaces would otherwise read as a confident zero.
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "bigint") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
