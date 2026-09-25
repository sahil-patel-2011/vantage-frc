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
import { applyOrder, describePlace, planDrop, readingOrder } from "../../lib/dashboard/board-order";
import {
  DASHBOARD_COLUMNS,
  catalogEntry,
  packDashboardLayout,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type WidgetCatalogEntry,
} from "../../lib/dashboard/catalog";
import {
  DRAG_CANCEL_DISTANCE,
  DRAG_LONG_PRESS_MS,
  DRAG_MOUSE_INTENT_DISTANCE,
  cellBox,
  columnStride,
  edgeAutoScrollDelta,
  exceedsDragCancelDistance,
  pointToCell,
  rowStride,
  type PointerPoint,
} from "../../lib/dashboard/grid-drag";
import { boardHasGap, layoutsEqual } from "../../lib/dashboard/edit-mode";
import {
  type DragActivation,
  type DragSession,
  type DragView,
  type SnapFeedback,
} from "./dashboard-board-types";

type CanvasRect = { left: number; top: number; width: number; bottom: number; right: number };

/**
 * Pointer drag for Home edit mode — mouse, touch, and pen share one session.
 * Keyboard reordering lives in useDashboardBoardOps.
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
  /** Remember the layout a finished drag replaced, for Undo. */
  record: (snapshot: DashboardWidgetLayout[]) => void;
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
    record,
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
    /*
      A moving card is followed by a copy of itself, not a name badge. The
      card's own slot turns into the dashed drop target, so without the copy
      the thing you picked up simply vanished from under your finger. The copy
      is cloned DOM in an element React renders empty and never touches.
    */
    const host = node.querySelector<HTMLElement>("[data-proxy-copy]");
    if (host && host.childElementCount === 0 && session.sourceNode) {
      host.appendChild(session.sourceNode.cloneNode(true));
    }
    const x = session.point.x - session.grab.x;
    const y = session.point.y - session.grab.y;
    const lift = session.kind === "move" ? " rotate(1.2deg) scale(1.02)" : "";
    node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)${lift}`;
    node.style.opacity = session.kind === "move" ? "0.88" : "1";
  }

  /*
    The dashed slot shows where the card will really land. A move is a change of
    order — onto a same-size card swaps the two, onto a different size goes
    before or after it — and the board is packed the way Home packs it, so no
    gap opens up behind the card and Home, Preview and the edit board agree.
    Judged against the board as it was when the drag began, so the answer does
    not flicker as cards slide around under the pointer.
  */
  function planFor(session: DragSession, rect: CanvasRect) {
    if (session.cols === 1) {
      // A phone board is one stack, so a drop is an insert: the card goes before the first
      // card whose middle is below its own.
      const dragged = session.baseDisplay.find((item) => item.i === session.id);
      const center = session.cell.row + (dragged?.h ?? session.span.h) / 2;
      const others = readingOrder(session.baseDisplay).filter((id) => id !== session.id);
      const index = others.filter((id) => {
        const item = session.baseDisplay.find((row) => row.i === id);
        return item ? item.y + item.h / 2 < center : false;
      }).length;
      return { order: [...others.slice(0, index), session.id, ...others.slice(index)], targetId: null, mode: "gap" as const };
    }
    const point = {
      col: Math.max(0, Math.min(session.cols - 0.01, (session.point.x - rect.left) / columnStride(rect.width, session.cols, session.gap))),
      row: Math.max(0, (session.point.y - rect.top) / rowStride(session.rowHeight, session.gap)),
    };
    return planDrop(session.baseDisplay, session.id, point, session.cols);
  }

  function previewMove(session: DragSession, rect: CanvasRect) {
    const plan = planFor(session, rect);
    const key = plan.order.join("|");
    const where = describePlace(session.baseDisplay, plan.order, session.id, plan.mode, plan.targetId);
    setSnapFeedback({ mode: "Moving", label: session.label, where });
    session.where = where;
    if (key === session.orderKey) return;
    session.orderKey = key;
    setLayout(applyOrder(session.baseLayout, plan.order));
  }

  /** "Placing Batteries · after Hours this month" — where an added card goes, in card words. */
  function describeAdd(session: DragSession) {
    const others = readingOrder(session.baseDisplay);
    const index = others.filter((id) => {
      const item = session.baseDisplay.find((row) => row.i === id);
      return item ? item.y < session.cell.row || (item.y === session.cell.row && item.x < session.cell.col) : false;
    }).length;
    const order = [...others.slice(0, index), session.id, ...others.slice(index)];
    return describePlace(session.baseDisplay, order, session.id);
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
    const cellChanged = cell.col !== session.cell.col || cell.row !== session.cell.row;
    session.cell = cell;
    if (session.kind === "move") {
      previewMove(session, rect);
      return;
    }
    if (!cellChanged && session.where) return;
    session.where = describeAdd(session);
    setDrag((current) => (current ? { ...current, cell } : current));
    setSnapFeedback({ mode: "Placing", label: session.label, where: session.where });
  }

  function startAutoScroll() {
    if (rafRef.current !== null) return;
    const step = () => {
      const session = dragRef.current;
      if (!session?.active) {
        rafRef.current = null;
        return;
      }
      const delta = edgeAutoScrollDelta(session.point.y, window.innerHeight, chromeInsets());
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
    setSnapFeedback({ mode: session.kind === "move" ? "Moving" : "Placing", label: session.label, where: "" });
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
      "pointerId" | "captureTarget" | "active" | "origin" | "point" | "baseLayout" | "baseDisplay" | "sourceNode"
    > & { sourceNode?: HTMLElement | null },
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
      sourceNode: session.sourceNode ?? null,
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
      sourceNode: card.querySelector<HTMLElement>(".dash-widget-hit"),
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

    // "Moved after My day" while the card snapped back told a screen reader something false.
    const changed = !layoutsEqual(settled.baseLayout, layoutRef.current);
    setAnnounce(changed && settled.where ? `${settled.label} moved ${settled.where}.` : `${settled.label} stayed where it was. No change.`);
    endDrag(false);
    if (changed) record(settled.baseLayout);
    // Cards keep the order you set, so moving a small card ahead of a full-width one leaves the
    // rest of its row empty. Say so and name the one-tap fix, instead of saving a silent hole.
    if (changed && boardHasGap(packDashboardLayout([...layoutRef.current]), DASHBOARD_COLUMNS)) {
      setMessageKind("success");
      setMessage("That left a gap in a row. Drag a card into it, or use ••• › Snap & tidy to fill it.");
    }
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

/** How much of the top and bottom of the screen fixed chrome covers (app bar, event strip, tabs). */
function chromeInsets(): { top: number; bottom: number } {
  const bottomOf = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? 0;
  const top = Math.max(0, bottomOf(".soft-topbar"), bottomOf(".soft-focus-rail"));
  // The tab bar, or the edit toolbar that replaces it on a phone while editing.
  const covered = [".soft-island", ".dash-editbar"]
    .map((selector) => document.querySelector(selector)?.getBoundingClientRect())
    .filter((rect): rect is DOMRect => Boolean(rect && rect.height > 0 && rect.top > window.innerHeight / 2))
    .map((rect) => window.innerHeight - rect.top);
  const bottom = Math.max(0, ...covered);
  return { top, bottom };
}
