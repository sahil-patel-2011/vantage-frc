"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { ToolStripEntry } from "../../lib/nav/tool-strip-layout";
import { useDismissable } from "../../lib/ui/use-dismissable";

export type ToolStripItem = ToolStripEntry;

type ToolStripProps = {
  items: ToolStripItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label": string;
};

function ToolLink({
  item,
  active,
  onChange,
  onPick,
}: {
  item: ToolStripItem;
  active: boolean;
  onChange: (id: string) => void;
  onPick?: () => void;
}) {
  const className = `hub-tool-chip${active ? " is-active" : ""}`;
  if (item.href && !active) {
    return (
      <a className={className} href={item.href} onClick={onPick}>
        {item.label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={className}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        onChange(item.id);
        onPick?.();
      }}
    >
      {item.label}
    </button>
  );
}

/**
 * One control for the rest of a workbench. The current tool is a label;
 * everything else lives in a searchable list — not a chip row.
 * Click outside or Escape closes it; the × is not required.
 */
export function ToolStrip({ items, value, onChange, "aria-label": ariaLabel }: ToolStripProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);
  useDismissable(open, close, rootRef);
  const current = items.find((item) => item.id === value) ?? items[0];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  }, [items, query]);

  if (items.length <= 1) return null;

  return (
    <div ref={rootRef} className={`hub-tool-strip${open ? " is-open" : ""}`}>
      {open ? (
        <button
          type="button"
          className="hub-tool-finder-scrim"
          aria-label="Dismiss tools"
          onClick={close}
        />
      ) : null}
      <button
        type="button"
        className="hub-tool-finder-trigger"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setOpen((currentOpen) => !currentOpen);
          setQuery("");
        }}
      >
        <span>{current?.label ?? "Tools"}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div className="hub-tool-finder" role="dialog" aria-label={ariaLabel}>
          <label className="hub-tool-finder-search">
            <span className="visually-hidden">Search this workbench</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a tool"
              autoFocus
            />
          </label>
          <div className="hub-tool-finder-list">
            {filtered.map((item) => (
              <ToolLink
                key={item.id}
                item={item}
                active={item.id === value}
                onChange={onChange}
                onPick={close}
              />
            ))}
            {filtered.length === 0 ? <p className="hub-tool-finder-empty">Nothing matches.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
