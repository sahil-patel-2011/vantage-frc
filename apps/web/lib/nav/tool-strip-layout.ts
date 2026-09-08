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
};

export type ToolStripLayout<T extends ToolStripEntry> = {
  visible: T[];
  hidden: T[];
  hiddenCount: number;
};

/**
 * Order by pinned-ness, keeping the active tool visible no matter how far down
 * the list it sits, then split at `visibleCount`. Ordering is stable so chips
 * do not reshuffle as a member moves between tools in the same workbench — and
 * the split is the same whether or not the overflow block is open, so opening
 * it does not move the row you just tapped.
 */
export function layoutToolStrip<T extends ToolStripEntry>(
  items: T[],
  activeId: string,
  visibleCount = 6,
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
    return { visible: ordered, hidden: [], hiddenCount: 0 };
  }

  const limit = Math.max(1, visibleCount);
  const visible = ordered.slice(0, limit);
  const hidden = ordered.slice(limit);
  return { visible, hidden, hiddenCount: hidden.length };
}
