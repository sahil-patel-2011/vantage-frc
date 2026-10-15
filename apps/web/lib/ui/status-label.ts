/**
 * A stored status as people read it: "in_progress" → "In progress", "finalized" → "Finalized".
 *
 * Badges used to print the database value as it is (lowercase, sometimes snake_case). Known
 * words keep a better name where one exists; anything else is turned into a sentence.
 */
const NAMES: Record<string, string> = {
  done: "Done",
  open: "Open",
  todo: "To do",
  in_progress: "In progress",
  finalized: "Final",
  draft: "Draft",
  archived: "Archived",
  retired: "Retired",
  requested: "Requested",
  fulfilled: "Fulfilled",
  shipped: "Shipped",
  cancelled: "Cancelled",
  canceled: "Cancelled",
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Note",
};

export function statusLabel(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase();
  if (NAMES[key]) return NAMES[key];
  const words = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
