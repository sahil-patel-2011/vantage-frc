"use client";

import { useId, useState } from "react";
import { layoutToolStrip, type ToolStripEntry } from "../../lib/nav/tool-strip-layout";

export type ToolStripItem = ToolStripEntry;

type ToolStripProps = {
  items: ToolStripItem[];
  value: string;
  onChange: (id: string) => void;
  /** Also the heading of the overflow list, e.g. "Tools in Strategy". */
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
  const overflowId = useId();

  if (items.length < 1) return null;

  /**
   * The split is computed the same way open or closed, so the front row does
   * not reshuffle under the thumb that just tapped it — expanding used to
   * re-lay the whole row and move every chip.
   */
  const { visible, hidden } = layoutToolStrip(items, value, visibleCount);
  const collapsible = hidden.length > 0;

  const renderChip = (item: ToolStripItem) => {
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
        {visible.map(renderChip)}
        {collapsible ? (
          <button
            type="button"
            className="hub-tool-chip hub-tool-more"
            aria-expanded={expanded}
            aria-controls={overflowId}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Show fewer" : `+${hidden.length} more`}
          </button>
        ) : null}
      </nav>
      {/* Strategy carries two dozen tools and Robot thirty. Opening them pushed
          the page's own content off the fold; the rest now land in a named,
          bounded block instead of an unbounded wall of chips. */}
      {collapsible && expanded ? (
        <div className="hub-tool-overflow" id={overflowId}>
          <p className="hub-tool-overflow-head">{ariaLabel}</p>
          <nav className="hub-tool-strip-row" aria-label={`More ${ariaLabel.toLowerCase()}`}>
            {hidden.map(renderChip)}
          </nav>
        </div>
      ) : null}
    </div>
  );
}
