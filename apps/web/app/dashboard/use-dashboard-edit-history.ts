"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { DashboardWidgetLayout } from "../../lib/dashboard/catalog";
import { popHistory, pushHistory } from "../../lib/dashboard/edit-mode";

/**
 * Undo and redo for the edit-mode draft. Every change that moves, adds, removes
 * or resizes a card records the layout it replaced; Undo steps back through
 * them and Redo steps forward again, until a new change starts a new branch.
 * The history belongs to one edit session — it starts empty each time you tap
 * Edit and is dropped on Done or Cancel, because nothing outside edit mode can
 * be undone and a stale step would undo a board you already saved.
 */
export function useDashboardEditHistory(input: {
  editing: boolean;
  previewing?: boolean;
  setLayout: Dispatch<SetStateAction<DashboardWidgetLayout[]>>;
  /** The draft as it stands, so Undo can hand it to Redo. */
  current: () => DashboardWidgetLayout[];
}) {
  const { editing, setLayout, current } = input;
  const stackRef = useRef<DashboardWidgetLayout[][]>([]);
  const redoRef = useRef<DashboardWidgetLayout[][]>([]);
  const [depth, setDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);

  const record = useCallback((snapshot: DashboardWidgetLayout[]) => {
    stackRef.current = pushHistory(stackRef.current, snapshot);
    redoRef.current = [];
    setDepth(stackRef.current.length);
    setRedoDepth(0);
  }, []);

  const undo = useCallback((): boolean => {
    const { layout, stack } = popHistory(stackRef.current);
    stackRef.current = stack;
    setDepth(stack.length);
    if (!layout) return false;
    redoRef.current = pushHistory(redoRef.current, current());
    setRedoDepth(redoRef.current.length);
    setLayout(layout);
    return true;
  }, [setLayout, current]);

  const redo = useCallback((): boolean => {
    const { layout, stack } = popHistory(redoRef.current);
    redoRef.current = stack;
    setRedoDepth(stack.length);
    if (!layout) return false;
    stackRef.current = pushHistory(stackRef.current, current());
    setDepth(stackRef.current.length);
    setLayout(layout);
    return true;
  }, [setLayout, current]);

  // Preview turns editing off and Back turns it on again with the draft intact, so the
  // history resets only when the whole session (editing or previewing) is over.
  const inSession = editing || Boolean(input.previewing);
  useEffect(() => {
    if (inSession) return;
    stackRef.current = [];
    redoRef.current = [];
    setDepth(0);
    setRedoDepth(0);
  }, [inSession]);

  return { canUndo: depth > 0, canRedo: redoDepth > 0, record, undo, redo };
}
