"use client";

import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { applyGridDrag } from "../../lib/dashboard/boards";
import {
  DASHBOARD_COLUMNS,
  catalogEntry,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type WidgetCatalogEntry,
} from "../../lib/dashboard/catalog";
import {
  DRAG_CANCEL_DISTANCE,
  DRAG_LONG_PRESS_MS,
  DRAG_MOUSE_INTENT_DISTANCE,
  cellBox,
  describeCellMove,
  edgeAutoScrollDelta,
  exceedsDragCancelDistance,
  layoutOrder,
  moveItem,
  pointToCell,
  reorderLayout,
  type PointerPoint,
} from "../../lib/dashboard/grid-drag";
import {
  type DragActivation,
  type DragSession,
  type DragView,
  type SnapFeedback,
} from "./dashboard-board-types";

type CanvasRect = { left: number; top: number; width: number; bottom: number; right: number };

/**
 * Pointer drag for Home edit mode — mouse, touch, and pen share one session.
 * Keyboard reordering stays in the dashboard client.
 */
export function useDashboardPointerDrag(input: {
  editing: boolean;
  saving: boolean;
  canvasNode: HTMLElement | null;
  cols: number;
  gap: number;
  rowHeight: number;
  canvasWidth: number;
  layoutRef: MutableRefObject<DashboardWidgetLayout[]>;
  displayRef: MutableRefObject<DashboardWidgetLayout[]>;
  grabBaseRef: MutableRefObject<DashboardWidgetLayout[] | null>;
  setLayout: Dispatch<SetStateAction<DashboardWidgetLayout[]>>;
  addWidget: (type: DashboardWidgetType, drop?: { col: number; row: number }, displayCols?: number) => void;
  setMessage: (message: string) => void;
  setMessageKind: Dispatch<SetStateAction<"success" | "error">>;
  setAnnounce: (message: string) => void;
  setGrabbedId: Dispatch<SetStateAction<string | null>>;
}) {
  const {
    editing,
    saving,
    canvasNode,
    cols,
    gap,
    rowHeight,
    canvasWidth,
    layoutRef,
    displayRef,
    grabBaseRef,
    setLayout,
    addWidget,
    setMessage,
    setMessageKind,
    setAnnounce,
    setGrabbedId,
  } = input;

  const [dragging, setDragging] = useState(false);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [snapFeedback, setSnapFeedback] = useState<SnapFeedback | null>(null);

  const dragRef = useRef<DragSession | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const longPressRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const keyListenerRef = useRef<((event: KeyboardEvent) => void) | null>(null);
  const touchListenerRef = useRef<((event: TouchEvent) => void) | null>(null);
  const suppressClickRef = useRef(false);

  function clearLongPress() {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  function stopAutoScroll() {
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function detachDragListeners() {
    if (keyListenerRef.current) {
      window.removeEventListener("keydown", keyListenerRef.current);
      keyListenerRef.current = null;
    }
    if (touchListenerRef.current) {
      document.removeEventListener("touchmove", touchListenerRef.current);
      touchListenerRef.current = null;
    }
  }

  function canvasRect(): CanvasRect | null {
    if (!canvasNode) return null;
    const rect = canvasNode.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, bottom: rect.bottom, right: rect.right };
  }

  function paintProxy() {
    const session = dragRef.current;
    const node = proxyRef.current;
    if (!session || !node) return;
    const x = session.point.x - session.grab.x;
    const y = session.point.y - session.grab.y;
    node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    node.style.opacity = "1";
  }

  function previewMove(session: DragSession) {
    const nextDisplay = moveItem(session.baseDisplay, session.id, session.cell, session.cols);
    setLayout(
      session.cols === 1
        ? reorderLayout(session.baseLayout, layoutOrder(nextDisplay))
        : applyGridDrag(session.baseLayout, nextDisplay, session.cols),
    );
  }

  function refreshDragCell() {
    const session = dragRef.current;
    if (!session?.active) return;
    const rect = canvasRect();
    if (!rect) return;
    const anchor = {
      x: session.point.x - session.grab.x + 6,
      y: session.point.y - session.grab.y + 6,
    };
    const cell = pointToCell(anchor, rect, session.cols, session.rowHeight, session.gap);
    if (cell.col === session.cell.col && cell.row === session.cell.row) return;
    session.cell = cell;
    if (session.kind === "move") previewMove(session);
    setDrag((current) => (current ? { ...current, cell } : current));
    setSnapFeedback({
      mode: session.kind === "move" ? "Moving" : "Placing",
      x: cell.col,
      y: cell.row,
      w: session.span.w,
      h: session.span.h,
    });
  }

  function startAutoScroll() {
    if (rafRef.current !== null) return;
    const step = () => {
      const session = dragRef.current;
      if (!session?.active) {
        rafRef.current = null;
        return;
      }
      const delta = edgeAutoScrollDelta(session.point.y, window.innerHeight);
      if (delta !== 0) {
        window.scrollBy(0, delta);
        refreshDragCell();
      }
      rafRef.current = window.requestAnimationFrame(step);
    };
    rafRef.current = window.requestAnimationFrame(step);
  }

  function endDrag(restore: boolean) {
    const session = dragRef.current;
    clearLongPress();
    stopAutoScroll();
    detachDragListeners();
    dragRef.current = null;
    setDrag(null);
    setDragging(false);
    setSnapFeedback(null);
    if (!session) return;
    const target = session.captureTarget as (Element & { releasePointerCapture?: (id: number) => void }) | null;
    try {
      if (target?.releasePointerCapture) target.releasePointerCapture(session.pointerId);
    } catch {
      /* pointer already released */
    }
    if (restore && session.active && session.kind === "move") setLayout(session.baseLayout);
  }

  function activateDrag() {
    clearLongPress();
    const session = dragRef.current;
    if (!session || session.active) return;
    session.active = true;
    session.baseLayout = layoutRef.current;
    session.baseDisplay = displayRef.current;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      endDrag(true);
      setAnnounce(`${session.label} move cancelled.`);
    };
    const onTouch = (event: TouchEvent) => {
      if (dragRef.current?.active && event.cancelable) event.preventDefault();
    };
    keyListenerRef.current = onKey;
    touchListenerRef.current = onTouch;
    window.addEventListener("keydown", onKey);
    document.addEventListener("touchmove", onTouch, { passive: false });

    setDragging(true);
    setDrag({
      kind: session.kind,
      id: session.id,
      type: session.type,
      label: session.label,
      cell: session.cell,
      span: session.span,
      size: session.size,
    });
    setSnapFeedback({
      mode: session.kind === "move" ? "Moving" : "Placing",
      x: session.cell.col,
      y: session.cell.row,
      w: session.span.w,
      h: session.span.h,
    });
    startAutoScroll();
    window.requestAnimationFrame(() => {
      paintProxy();
      refreshDragCell();
    });
  }

  function beginSession(
    event: ReactPointerEvent<HTMLElement>,
    session: Omit<
      DragSession,
      "pointerId" | "captureTarget" | "active" | "origin" | "point" | "baseLayout" | "baseDisplay"
    >,
  ) {
    if (dragRef.current) endDrag(true);
    const point = { x: event.clientX, y: event.clientY };
    const target = event.currentTarget as HTMLElement & { setPointerCapture?: (id: number) => void };
    try {
      target.setPointerCapture?.(event.pointerId);
    } catch {
      /* capture is best-effort */
    }
    dragRef.current = {
      ...session,
      pointerId: event.pointerId,
      captureTarget: target,
      active: false,
      origin: point,
      point,
      baseLayout: layoutRef.current,
      baseDisplay: displayRef.current,
    };
    if (session.activation === "immediate") {
      activateDrag();
      return;
    }
    if (session.activation === "longpress") {
      longPressRef.current = window.setTimeout(activateDrag, DRAG_LONG_PRESS_MS);
    }
  }

  function beginCardDrag(
    event: ReactPointerEvent<HTMLElement>,
    item: DashboardWidgetLayout,
    activation: DragActivation,
  ) {
    if (!editing || saving) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const card = (event.currentTarget as HTMLElement).closest(".dash-grid-item") as HTMLElement | null;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    setGrabbedId(null);
    grabBaseRef.current = null;
    beginSession(event, {
      kind: "move",
      id: item.i,
      type: item.type,
      label: catalogEntry(item.type)?.label ?? item.type,
      activation,
      grab: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      size: { width: rect.width, height: rect.height },
      span: { w: item.w, h: item.h },
      cell: { col: item.x, row: item.y },
      cols,
      rowHeight,
      gap,
    });
  }

  function beginPaletteDrag(event: ReactPointerEvent<HTMLElement>, entry: WidgetCatalogEntry) {
    if (!editing || saving) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const span = {
      w: Math.max(1, Math.min(cols, Math.round((entry.defaultW * cols) / DASHBOARD_COLUMNS))),
      h: entry.defaultH,
    };
    const box = cellBox({ x: 0, y: 0, ...span }, canvasWidth, cols, rowHeight, gap);
    beginSession(event, {
      kind: "add",
      id: `add-${entry.type}`,
      type: entry.type,
      label: entry.label,
      activation: event.pointerType === "mouse" ? "intent" : "longpress",
      grab: { x: Math.min(event.clientX - rect.left, box.width / 2), y: Math.min(event.clientY - rect.top, 28) },
      size: { width: box.width, height: box.height },
      span,
      cell: { col: 0, row: 0 },
      cols,
      rowHeight,
      gap,
    });
  }

  function onDragPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    session.point = { x: event.clientX, y: event.clientY };

    if (!session.active) {
      const threshold =
        session.activation === "intent" ? DRAG_MOUSE_INTENT_DISTANCE : DRAG_CANCEL_DISTANCE;
      if (!exceedsDragCancelDistance(session.origin, session.point, threshold)) return;
      if (session.activation === "intent") activateDrag();
      else endDrag(true);
      return;
    }

    if (event.cancelable) event.preventDefault();
    paintProxy();
    refreshDragCell();
  }

  function pointerIsOverCanvas(point: PointerPoint) {
    const rect = canvasRect();
    if (!rect) return false;
    const slack = 40;
    return (
      point.x >= rect.left - slack &&
      point.x <= rect.right + slack &&
      point.y >= rect.top - slack &&
      point.y <= rect.bottom + slack
    );
  }

  function onDragPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    if (!session.active) {
      endDrag(false);
      return;
    }
    session.point = { x: event.clientX, y: event.clientY };
    refreshDragCell();
    const settled = dragRef.current;
    if (!settled) return;

    if (settled.kind === "add") {
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
      if (!canvasNode || pointerIsOverCanvas(settled.point)) {
        addWidget(settled.type, settled.cell, settled.cols);
      } else {
        setMessageKind("error");
        setMessage(`${settled.label} was dropped outside the board — nothing added.`);
      }
      endDrag(false);
      return;
    }

    setAnnounce(`${describeCellMove(settled.label, settled.cell)}.`);
    endDrag(false);
  }

  function onDragPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    endDrag(true);
  }

  useEffect(
    () => () => {
      clearLongPress();
      stopAutoScroll();
      detachDragListeners();
    },
    [],
  );

  useEffect(() => {
    if (!editing && dragRef.current) endDrag(true);
    if (!editing) setGrabbedId(null);
  }, [editing]);

  return {
    dragging,
    drag,
    snapFeedback,
    proxyRef,
    suppressClickRef,
    beginCardDrag,
    beginPaletteDrag,
    onDragPointerMove,
    onDragPointerUp,
    onDragPointerCancel,
    paintProxy,
  };
}
