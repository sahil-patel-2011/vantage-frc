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

  const { visible, hiddenCount } = layoutToolStrip(items, value, visibleCount, expanded);
  const collapsible = items.length > visibleCount;

  return (
    <div className="hub-tool-strip">
      <nav
        className={`hub-tool-strip-row${expanded ? " is-expanded" : ""}`}
        aria-label={ariaLabel}
      >
        {visible.map((item) => {
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
        })}
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
    </div>
  );
}
