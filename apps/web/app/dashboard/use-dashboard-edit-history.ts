"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardWidgetLayout } from "../../lib/dashboard/catalog";
import { popHistory, pushHistory } from "../../lib/dashboard/edit-mode";

/**
 * Undo for the edit-mode draft. Every change that moves, adds, removes or
 * resizes a card records the layout it replaced; Undo steps back through them.
 * The history belongs to one edit session — it starts empty each time you tap
 * Edit and is dropped on Done or Cancel, because nothing outside edit mode can
 * be undone and a stale step would undo a board you already saved.
 */
export function useDashboardEditHistory(input: {
  editing: boolean;
  setLayout: Dispatch<SetStateAction<DashboardWidgetLayout[]>>;
}) {
  const { editing, setLayout } = input;
  const stackRef = useRef<DashboardWidgetLayout[][]>([]);
  const [depth, setDepth] = useState(0);

  const record = useCallback((snapshot: DashboardWidgetLayout[]) => {
    stackRef.current = pushHistory(stackRef.current, snapshot);
    setDepth(stackRef.current.length);
  }, []);

  const undo = useCallback((): boolean => {
    const { layout, stack } = popHistory(stackRef.current);
    stackRef.current = stack;
    setDepth(stack.length);
    if (!layout) return false;
    setLayout(layout);
    return true;
  }, [setLayout]);

  useEffect(() => {
    stackRef.current = [];
    setDepth(0);
  }, [editing]);

  return { canUndo: depth > 0, record, undo };
}
