import { canonicalIslandHref } from "./island-preferences";

/**
 * The page bar skips a section that is already a pinned app (sidebar and phone dock), except
 * the section you're on. Unpinning puts it back on the bar, so a shortcut is never the only door.
 */
export function hubBarSections<T extends { id: string }>(
  hubPath: string,
  sections: readonly T[],
  pinnedHrefs: readonly string[],
  selectedId: string | null,
): T[] {
  const pinned = new Set(pinnedHrefs.map((href) => canonicalIslandHref(href.split("#")[0] ?? href)));
  const visible = sections.filter((section) => {
    if (section.id === selectedId) return true;
    return !pinned.has(canonicalIslandHref(`${hubPath}?tab=${section.id}`));
  });
  return visible.length > 0 ? visible : [...sections];
}
