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
   * How many chips stay on screen before the rest go behind "More tools".
   * The rest are still one tap away and are listed with a description, so the
   * choice is made from what a tool is for rather than from opening it.
   */
  visibleCount?: number;
  /** One line on what a tool is for, shown in the "More tools" list. */
  describe?: (id: string) => string | undefined;
};

/**
 * Horizontal tool switcher for a hub workbench.
 *
 * Two behaviours matter here: a tool the hub renders inline switches the tab
 * in place, while a tool that lives on its own route is a real link, so it
 * goes straight there instead of bouncing through a redirect interstitial.
 *
 * The front row is the featured tools. Everything else is behind ONE control,
 * "More tools", which opens a readable list — name and what it is for — not a
 * second wall of chips. That is the whole disclosure: section, then tool.
 */
export function ToolStrip({
  items,
  value,
  onChange,
  "aria-label": ariaLabel,
  visibleCount = 6,
  describe,
}: ToolStripProps) {
  const [expanded, setExpanded] = useState(false);
  const overflowId = useId();

  if (items.length < 1) return null;

  /**
   * The split is computed the same way open or closed, so the front row does
   * not reshuffle under the thumb that just tapped it.
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

  const renderRow = (item: ToolStripItem) => {
    const active = item.id === value;
    const blurb = describe?.(item.id);
    const body = (
      <>
        <span>{item.label}</span>
        {blurb ? <small>{blurb}</small> : <small />}
      </>
    );
    if (item.href && !active) {
      return (
        <li key={item.id}>
          <a href={item.href}>{body}</a>
        </li>
      );
    }
    return (
      <li key={item.id}>
        <button
          type="button"
          className={active ? "is-active" : undefined}
          aria-current={active ? "page" : undefined}
          onClick={() => {
            onChange(item.id);
            setExpanded(false);
          }}
        >
          {body}
        </button>
      </li>
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
            {expanded ? "Fewer tools" : `More tools (${hidden.length})`}
          </button>
        ) : null}
      </nav>
      {collapsible && expanded ? (
        <div className="hub-tool-overflow" id={overflowId}>
          <p className="hub-tool-overflow-head">{ariaLabel}</p>
          <ul className="hub-tool-list" aria-label={`More ${ariaLabel.toLowerCase()}`}>
            {hidden.map(renderRow)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
