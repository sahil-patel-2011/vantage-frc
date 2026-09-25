"use client";

import { useEffect, useState } from "react";

/**
 * How many grid rows each card needed in the phone's read-only stack, where cards size to their
 * content. Measured while Home is showing (not while editing, when the grid sets the heights), so
 * the edit board can give every card at least that much room.
 */
export function usePhoneCardRows({
  canvasNode,
  active,
  rowHeight,
  gap,
}: {
  canvasNode: HTMLElement | null;
  active: boolean;
  rowHeight: number;
  gap: number;
}): Record<string, number> {
  const [rows, setRows] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!active || !canvasNode || typeof ResizeObserver === "undefined") return;
    const stride = rowHeight + gap;
    const measure = () => {
      const next: Record<string, number> = {};
      for (const card of canvasNode.querySelectorAll<HTMLElement>(":scope > [data-widget-id]")) {
        const id = card.dataset.widgetId;
        const height = card.getBoundingClientRect().height;
        if (id && height > 0) next[id] = Math.max(1, Math.ceil((height + gap) / stride));
      }
      setRows((prev) => {
        const keys = Object.keys(next);
        const same = keys.length === Object.keys(prev).length && keys.every((key) => prev[key] === next[key]);
        return same ? prev : next;
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvasNode);
    for (const card of canvasNode.querySelectorAll(":scope > [data-widget-id]")) observer.observe(card);
    measure();
    return () => observer.disconnect();
  }, [active, canvasNode, rowHeight, gap]);

  return rows;
}
