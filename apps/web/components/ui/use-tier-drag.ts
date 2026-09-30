"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

type Group<Tier extends string> = { tier: Tier; ids: string[] };
export type TierDrag<Tier extends string> = { id: string; tier: Tier; index: number };

/**
 * Drag-and-drop for lists split into tiers (columns or stacked panels): a handle on each row that
 * works with a finger, a mouse, or the arrow keys.
 *
 * Markup contract, so the hook can find things without refs on every row:
 *   - the root element:   ref={rootRef}
 *   - each tier's list:   data-tier-list={tier}
 *   - each row:           data-entry-id={id}
 *   - each row's handle:  {...handleProps(id, tier)}
 *   - a drop line:        render where `slotIndex(tier)` says (index among the rows that stay)
 *
 * `onMove` gets the slot counted among the rows that stay put, so 0 is the top of the tier.
 * Empty tiers must stay on screen while dragging: showing them only during a drag shifts the page
 * under the pointer and the drop lands in the wrong place.
 */
export function useTierDrag<Tier extends string>({
  groups,
  enabled,
  tierLabel,
  onMove,
}: {
  groups: Array<Group<Tier>>;
  enabled: boolean;
  tierLabel: (tier: Tier) => string;
  onMove: (id: string, tier: Tier, index: number) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<TierDrag<Tier> | null>(null);
  const refocus = useRef<string | null>(null);
  const [drag, setDrag] = useState<TierDrag<Tier> | null>(null);
  const [announcement, setAnnouncement] = useState("");

  // After a move the row appears in a new place; keep its handle focused so the arrow keys can
  // carry on. Keyed on the visible order, so it runs once the new order has arrived.
  const orderKey = groups.map((group) => group.ids.join(",")).join("|");
  useEffect(() => {
    const id = refocus.current;
    if (!id) return;
    refocus.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-handle="${CSS.escape(id)}"]`)?.focus();
  }, [orderKey]);

  /** The tier list nearest the pointer (both axes: columns sit side by side, panels stack) and the slot in it. */
  function locate(x: number, y: number, draggedId: string): { tier: Tier; index: number } | null {
    const lists = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-tier-list]") ?? [])];
    let best: HTMLElement | null = null;
    let bestDistance = Infinity;
    for (const list of lists) {
      const box = list.getBoundingClientRect();
      const dx = x < box.left ? box.left - x : x > box.right ? x - box.right : 0;
      const dy = y < box.top ? box.top - y : y > box.bottom ? y - box.bottom : 0;
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = list;
      }
    }
    if (!best) return null;
    const rows = [...best.querySelectorAll<HTMLElement>("[data-entry-id]")].filter((row) => row.dataset.entryId !== draggedId);
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i]!.getBoundingClientRect();
      if (y < box.top + box.height / 2) {
        index = i;
        break;
      }
    }
    return { tier: best.dataset.tierList as Tier, index };
  }

  function begin(id: string, tier: Tier, event: PointerEvent<HTMLElement>) {
    if (!enabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ids = groups.find((group) => group.tier === tier)?.ids ?? [];
    const start = { id, tier, index: Math.max(0, ids.indexOf(id)) };
    dragRef.current = start;
    setDrag(start);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const current = dragRef.current;
    if (!current) return;
    const target = locate(event.clientX, event.clientY, current.id);
    if (target && (target.tier !== current.tier || target.index !== current.index)) {
      const next = { id: current.id, ...target };
      dragRef.current = next;
      setDrag(next);
    }
    // Keep scrolling while a row is held near the top or bottom edge of the screen.
    if (event.clientY < 72) window.scrollBy(0, -14);
    else if (event.clientY > window.innerHeight - 72) window.scrollBy(0, 14);
  }

  function end(commit: boolean) {
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!current || !commit) return;
    // Dropped where it already was (same tier, same slot among the rows that stay): nothing to save.
    const from = groups.find((group) => group.tier === current.tier)?.ids ?? [];
    if (from.indexOf(current.id) === current.index) return;
    refocus.current = current.id;
    onMove(current.id, current.tier, current.index);
    setAnnouncement(`Moved to ${tierLabel(current.tier)}, place ${current.index + 1}.`);
  }

  function key(id: string, tier: Tier, event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    if (!enabled) return;
    const ids = groups.find((group) => group.tier === tier)?.ids ?? [];
    const from = ids.indexOf(id);
    const to = event.key === "ArrowUp" ? from - 1 : from + 1;
    if (from < 0 || to < 0 || to >= ids.length) return;
    refocus.current = id;
    onMove(id, tier, to);
    setAnnouncement(`Place ${to + 1} of ${ids.length} in ${tierLabel(tier)}.`);
  }

  return {
    rootRef,
    drag,
    announcement,
    /** Spread onto each row's handle button. */
    handleProps: (id: string, tier: Tier) => ({
      "data-handle": id,
      onPointerDown: (event: PointerEvent<HTMLElement>) => begin(id, tier, event),
      onPointerMove: move,
      onPointerUp: () => end(true),
      onPointerCancel: () => end(false),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => key(id, tier, event),
    }),
    /** Where to draw the drop line in `tier`: an index among the rows that stay, or null. */
    slotIndex: (tier: Tier): number | null => (drag && drag.tier === tier ? drag.index : null),
  };
}
