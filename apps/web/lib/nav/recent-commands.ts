/**
 * MRU command-palette destinations — device-local only, so the palette opens
 * on what this member actually uses instead of a generic shortcut list.
 */

const STORAGE_KEY = "vantage-recent-commands";
const MAX_RECENT = 5;

export function listRecentCommands(limit = MAX_RECENT): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((href): href is string => typeof href === "string" && href.startsWith("/"))
      .slice(0, Math.max(1, limit));
  } catch {
    return [];
  }
}

/** Record a real jump. Query strings are kept so `?tab=` lands on the right tab. */
export function rememberRecentCommand(href: string, limit = MAX_RECENT): string[] {
  const value = href.trim();
  if (!value.startsWith("/") || typeof window === "undefined") return listRecentCommands(limit);
  const next = [value, ...listRecentCommands(limit).filter((row) => row !== value)].slice(
    0,
    Math.max(1, limit),
  );
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota — recents are a convenience, never a hard failure.
  }
  return next;
}
