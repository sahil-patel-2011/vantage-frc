/**
 * Shapes a feature's own view into what an Ask AI skill hands the model and the chat.
 *
 * Pure. Nothing here invents a value: arrays are cut, long text is clipped, plumbing keys
 * (org ids, setup steps, rendered HTML) are dropped. An empty view stays empty.
 */

/** Keys that are plumbing, not team facts, or are too big to be useful to a model. */
const DROP_KEYS = new Set([
  "status",
  "orgId",
  "userId",
  "role",
  "steps",
  "seasons",
  "computedAt",
  "htmlContent",
  "html",
  "evidenceLibrary",
  "contactEmail",
  "email",
  "phone",
]);

export type BoundOptions = { maxItems?: number; maxText?: number; maxDepth?: number };

export function boundForModel(value: unknown, options: BoundOptions = {}, depth = 0): unknown {
  const maxItems = options.maxItems ?? 10;
  const maxText = options.maxText ?? 500;
  const maxDepth = options.maxDepth ?? 4;
  if (value == null) return value ?? null;
  if (typeof value === "string") return value.length > maxText ? `${value.slice(0, maxText)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= maxDepth) return Array.isArray(value) ? `[${value.length} items]` : "[…]";
  if (Array.isArray(value)) {
    const items = value.slice(0, maxItems).map((item) => boundForModel(item, options, depth + 1));
    return value.length > maxItems ? [...items, `…and ${value.length - maxItems} more`] : items;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (DROP_KEYS.has(key)) continue;
      if (typeof entry === "function" || entry === undefined) continue;
      out[key] = boundForModel(entry, options, depth + 1);
    }
    return out;
  }
  return null;
}

/** "liveAgendaItems" → "live agenda items". */
export function wordsFromKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .trim();
}

const TITLE_FIELDS = ["title", "name", "sponsorName", "contactName", "teamKey", "matchKey", "summary", "label", "headline", "subject"];

/** The best short label a record has, or null. */
export function recordLabel(record: unknown): string | null {
  if (!record || typeof record !== "object") return typeof record === "string" ? record.slice(0, 80) : null;
  const row = record as Record<string, unknown>;
  for (const field of TITLE_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 80);
  }
  return null;
}

/**
 * Plain lines for a live view: one per non-empty list ("3 reports: Arm bent, …"), skipping the
 * plumbing keys. Empty lists are not mentioned — an empty view yields no lines.
 */
export function viewHighlights(view: Record<string, unknown>, maxLines = 6): string[] {
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(view)) {
    if (DROP_KEYS.has(key) || !Array.isArray(entry) || !entry.length) continue;
    const labels = entry.slice(0, 3).map(recordLabel).filter((label): label is string => Boolean(label));
    const noun = wordsFromKey(key);
    lines.push(labels.length ? `${entry.length} ${noun}: ${labels.join("; ")}${entry.length > 3 ? "; …" : ""}` : `${entry.length} ${noun}`);
    if (lines.length >= maxLines) break;
  }
  return lines;
}

/** True when a live view has no records in any of its lists. */
export function viewIsEmpty(view: Record<string, unknown>): boolean {
  let lists = 0;
  for (const [key, entry] of Object.entries(view)) {
    if (DROP_KEYS.has(key) || !Array.isArray(entry)) continue;
    lists += 1;
    if (entry.length) return false;
  }
  return lists > 0;
}

/** "12345" cents → "$123.45"; zero or missing → null (no invented $0). */
export function dollarsOrNull(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return null;
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
