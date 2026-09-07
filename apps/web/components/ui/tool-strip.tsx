"use client";

import { useState } from "react";
import { layoutToolStrip, type ToolStripEntry } from "../../lib/nav/tool-strip-layout";

export type ToolStripItem = ToolStripEntry;

type ToolStripProps = {
  items: ToolStripItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label": string;
  /**
   * How many chips stay on screen before the rest collapse behind "+N more".
   * Everything expands in place — nothing is hidden the way a <select> hides
   * its options behind a click.
   */
  visibleCount?: number;
};

/**
 * Horizontal tool switcher for a hub workbench.
 *
 * Two behaviours matter here: a tool the hub renders inline switches the tab
 * in place, while a tool that lives on its own route is a real link, so it
 * goes straight there instead of bouncing through a redirect interstitial.
 *
 * Expanding opens the rest as titled groups rather than extending the row.
 * Robot carries 27 tools and Strategy 25 — as one run that reads as a wall of
 * chips, and you cannot find anything in it. Grouping is presentation only:
 * still one disclosure step, and ⌘K is unchanged.
 */
export function ToolStrip({
  items,
  value,
  onChange,
  "aria-label": ariaLabel,
  visibleCount = 6,
}: ToolStripProps) {
  const [expanded, setExpanded] = useState(false);

  if (items.length <= 1) return null;

  const { visible, hiddenCount, groups } = layoutToolStrip(items, value, visibleCount, expanded);
  const collapsible = items.length > visibleCount;

  const chip = (item: ToolStripItem) => {
    const active = item.id === value;
    const className = `hub-tool-chip${active ? " is-active" : ""}`;
    if (item.href && !active) {
      return (
        <a key={item.id} className={className} href={item.href}>
          {item.label}
        </a>
      );
    }
    return (
      <button
        key={item.id}
        type="button"
        className={className}
        aria-current={active ? "page" : undefined}
        onClick={() => onChange(item.id)}
      >
        {item.label}
      </button>
    );
  };

  return (
    <div className="hub-tool-strip">
      <nav className="hub-tool-strip-row" aria-label={ariaLabel}>
        {visible.map(chip)}
        {collapsible ? (
          <button
            type="button"
            className="hub-tool-chip hub-tool-more"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show less" : `+${hiddenCount} more`}
          </button>
        ) : null}
      </nav>
      {expanded && groups.length > 0 ? (
        <div className="hub-tool-groups">
          {groups.map((group) => (
            <section key={group.family ?? "more"} className="hub-tool-group">
              {group.family ? <h3>{group.family}</h3> : null}
              <div className="hub-tool-group-row">{group.items.map(chip)}</div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}
