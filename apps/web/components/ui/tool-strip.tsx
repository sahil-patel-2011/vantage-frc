"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss";
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
   *
   * Defaults to three — see `DESKTOP_VISIBLE_COUNT`. Surfaces whose strip is a
   * short, complete set rather than the head of a long one pass their own.
   */
  visibleCount?: number;
  /** One line on what a tool is for, shown in the "More tools" list. */
  describe?: (id: string) => string | undefined;
  /**
   * Optional headings for the "More tools" list, in order, each listing tool ids most-used
   * first. Tools in no group follow under "More". Without it the list is one flat run.
   */
  groups?: ReadonlyArray<{ label: string; ids: readonly string[] }>;
};

/**
 * Chips on a phone, where six of them wrap to three rows.
 *
 * Strategy has 25 tools: six chips and "More tools (19)". Three rows of chips
 * above a button that holds most of the list is the expensive half of both
 * designs — it costs 150px above the content and still does not show you the
 * tools. Three chips and "More tools (22)" is one row, and the 22 are in the
 * same named list they were always in, each with a line saying what it is for.
 *
 * The active tool is never one of the ones that moves: `layoutToolStrip` ranks
 * it first, so whatever you are looking at stays on screen at any count.
 */
/**
 * Three chips, then one "More tools".
 *
 * This was six, and six near-identical pills in a row is not a menu — it is a
 * wall. Scouting showed Forms · Coverage · Shifts · Pit link · Training ·
 * Field value · More tools (1): seven controls, no hierarchy, nothing telling
 * you which of them you actually want, and the "More" at the end holding a
 * single item as if it were an afterthought rather than a category.
 *
 * Three is enough to show the shape of the section — the tool you are in is
 * ranked first, so it is always one of them — and everything else is behind
 * one control that opens a readable list with a line saying what each thing is
 * for. That is a better way to find a tool you have not used than a sixth pill
 * you have to read to rule out.
 */
const DESKTOP_VISIBLE_COUNT = 3;
const PHONE_VISIBLE_COUNT = 3;
const PHONE_QUERY = "(max-width: 720px)";

function usePhoneLayout(): boolean {
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(PHONE_QUERY);
    const apply = () => setPhone(media.matches);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return phone;
}

/** Hidden tools under their headings, in the order each group lists them; the rest last. */
function groupHidden(
  hidden: ToolStripItem[],
  groups: ReadonlyArray<{ label: string; ids: readonly string[] }>,
): Array<{ label: string; items: ToolStripItem[] }> {
  const placed = new Set<string>();
  const out: Array<{ label: string; items: ToolStripItem[] }> = [];
  for (const group of groups) {
    const items = group.ids
      .map((id) => hidden.find((item) => item.id === id))
      .filter((item): item is ToolStripItem => Boolean(item) && !placed.has(item!.id));
    for (const item of items) placed.add(item.id);
    if (items.length) out.push({ label: group.label, items });
  }
  const rest = hidden.filter((item) => !placed.has(item.id));
  if (rest.length) out.push({ label: "More", items: rest });
  return out;
}

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
  visibleCount = DESKTOP_VISIBLE_COUNT,
  describe,
  groups,
}: ToolStripProps) {
  const [expanded, setExpanded] = useState(false);
  const overflowId = useId();
  const phone = usePhoneLayout();
  // The ref wraps the "More tools" button as well as the list it opens, so
  // pressing the button to close does not read as a click outside the panel.
  //
  // These two live above the `items.length` guard on purpose. They used to sit
  // just before the JSX, which put two hooks after an early return: a hub whose
  // tool list arrives with its data renders empty once, then non-empty, and
  // React throws "rendered more hooks than during the previous render" on that
  // second pass. Every hook in this component now runs on every render.
  const closeOverflow = useCallback(() => setExpanded(false), []);
  const stripRef = useDismiss<HTMLDivElement>(expanded, closeOverflow);

  if (items.length < 1) return null;

  /**
   * The split is computed the same way open or closed, so the front row does
   * not reshuffle under the thumb that just tapped it.
   */
  const { visible, hidden } = layoutToolStrip(
    items,
    value,
    phone ? Math.min(PHONE_VISIBLE_COUNT, visibleCount) : visibleCount,
  );
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
    <div className="hub-tool-strip" ref={stripRef}>
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
          {groups?.length ? (
            groupHidden(hidden, groups).map((group) => (
              <section key={group.label} className="hub-tool-group">
                <h3 className="hub-tool-group-head">{group.label}</h3>
                <ul className="hub-tool-list" aria-label={group.label}>
                  {group.items.map(renderRow)}
                </ul>
              </section>
            ))
          ) : (
            <ul className="hub-tool-list" aria-label={`More ${ariaLabel.toLowerCase()}`}>
              {hidden.map(renderRow)}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
