"use client";

import { useId } from "react";
import type { ToolStripEntry } from "../../lib/nav/tool-strip-layout";

export type ToolStripItem = ToolStripEntry;

type ToolStripProps = {
  items: ToolStripItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label": string;
  /** Retained for callers; destination strips now use one native selector. */
  visibleCount?: number;
  compact?: boolean;
  /** Local form/response views benefit from visible, mutually exclusive choices. */
  presentation?: "select" | "segments";
  describe?: (id: string) => string | undefined;
  groups?: ReadonlyArray<{ label: string; ids: readonly string[] }>;
};

/** Shared single-control navigation for standalone pages, filters, and related tools. */
export function ToolStrip({ items, value, onChange, "aria-label": label, describe, groups, presentation = "select" }: ToolStripProps) {
  const id = useId();
  const choose = (next: string) => {
    const item = items.find(entry => entry.id === next);
    if (!item) return;
    if (item.href) window.location.assign(item.href);
    else onChange(item.id);
  };
  const placed = new Set((groups ?? []).flatMap(group => [...group.ids]));
  if (presentation === "segments") return <nav className="form-view-segments" aria-label={label}>{items.map(item =>
    <button type="button" key={item.id} aria-pressed={item.id === value} onClick={() => choose(item.id)}>{item.label}</button>,
  )}</nav>;
  return <label className="section-select" htmlFor={id}>
    <span className="sr-only">{label}</span>
    <select id={id} aria-label={label} value={items.some(item => item.id === value) ? value : ""} onChange={event => choose(event.target.value)}>
      {!items.some(item => item.id === value) ? <option value="" disabled>{label}</option> : null}
      {(groups ?? []).map(group => <optgroup key={group.label} label={group.label}>{items.filter(item => group.ids.includes(item.id)).map(item => <option key={item.id} value={item.id} title={describe?.(item.id)}>{item.label}</option>)}</optgroup>)}
      {items.filter(item => !placed.has(item.id)).map(item => <option key={item.id} value={item.id} title={describe?.(item.id)}>{item.label}</option>)}
    </select>
  </label>;
}
