/**
 * Layout maths for a hub workbench's tool switcher.
 *
 * Kept out of the component so the rules that matter — the active tool is
 * always on screen, the workbench root leads, nothing is silently dropped —
 * are unit-testable in this repo's node-only vitest setup.
 */

export type ToolStripEntry = {
  id: string;
  label: string;
  /** Workbench root and pinned tools lead the row. */
  featured?: boolean;
  /** Present when the tool lives on its own route. */
  href?: string;
  /** Heading this tool sits under once the strip is expanded. */
  family?: string;
};

export type ToolStripGroup<T extends ToolStripEntry> = {
  /** Null for tools with no family — they render first, without a heading. */
  family: string | null;
  items: T[];
};

export type ToolStripLayout<T extends ToolStripEntry> = {
  visible: T[];
  hidden: T[];
  hiddenCount: number;
  /** Hidden tools bucketed by family, for the expanded panel. */
  groups: ToolStripGroup<T>[];
};

/**
 * Bucket tools under their family heading, preserving catalog order both
 * between families and inside them. Ungrouped tools lead, so a workbench that
 * never set a family renders exactly as it always did — one flat run.
 */
export function groupToolStripEntries<T extends ToolStripEntry>(items: T[]): ToolStripGroup<T>[] {
  const groups: ToolStripGroup<T>[] = [];
  const byFamily = new Map<string | null, ToolStripGroup<T>>();
  for (const item of items) {
    const family = item.family ?? null;
    let group = byFamily.get(family);
    if (!group) {
      group = { family, items: [] };
      byFamily.set(family, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  // The unnamed bucket always leads, however far down its first tool sat.
  return groups.sort((a, b) => Number(a.family !== null) - Number(b.family !== null));
}

/**
 * Order by pinned-ness, keeping the active tool visible no matter how far down
 * the list it sits, then split at `visibleCount`. Ordering is stable so chips
 * do not reshuffle as a member moves between tools in the same workbench.
 */
export function layoutToolStrip<T extends ToolStripEntry>(
  items: T[],
  activeId: string,
  visibleCount = 6,
  expanded = false,
): ToolStripLayout<T> {
  const rank = (item: T): number => {
    if (item.id === activeId) return 0;
    if (item.featured) return 1;
    return 2;
  };

  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((entry) => entry.item);

  if (ordered.length <= visibleCount) {
    return { visible: ordered, hidden: [], hiddenCount: 0, groups: [] };
  }

  const limit = Math.max(1, visibleCount);
  const visible = ordered.slice(0, limit);
  const hidden = ordered.slice(limit);

  // Expanded, the panel groups the *whole* list, not just the tail. Grouping
  // only the overflow splits a family across the row and its own heading —
  // "Design" would list two tools while five more sat in the row above it.
  // The collapsed row's job is quick access; the open panel's job is a
  // complete, organised picture, so the row stands down while it is open.
  return {
    visible: expanded ? [] : visible,
    hidden,
    hiddenCount: hidden.length,
    groups: expanded ? groupToolStripEntries(ordered) : [],
  };
}
