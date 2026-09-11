"use client";

import {
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import {
  applyGridDrag,
  dropWidgetOntoLayout,
  duplicateBoardName,
  writeStoredBoardId,
} from "../../lib/dashboard/boards";
import {
  DASHBOARD_COLUMNS,
  WIDGET_SIZE_LABEL,
  applyWidgetSize,
  catalogEntry,
  defaultDashboardLayoutForAudience,
  layoutOrAudienceDefault,
  packDashboardLayout,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type WidgetCatalogEntry,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import {
  compactLayout,
  describeCellMove,
  layoutOrder,
  nudgeItem,
  pointToCell,
  reorderLayout,
  type GridCell,
  type NudgeDirection,
} from "../../lib/dashboard/grid-drag";
import { ARROW_DIRECTION, resolveGrid } from "./dashboard-canvas";
import type { BoardMeta, BoardState } from "./dashboard-board-types";

type LoadSnapshot = (
  id: string,
  types?: DashboardWidgetType[],
  opts?: { fullContext?: boolean; signal?: AbortSignal },
) => Promise<void>;

/**
 * Save / add / resize / keyboard reorder for Home. The client keeps poll,
 * measurement, and the painted grid; this hook owns the mutations those
 * controls fire.
 */
export function useDashboardBoardOps(input: {
  orgId: string;
  userId: string;
  board: BoardState | null;
  boards: BoardMeta[];
  layout: DashboardWidgetLayout[];
  layoutRef: MutableRefObject<DashboardWidgetLayout[]>;
  displayLayout: DashboardWidgetLayout[];
  cols: number;
  canShareOrg: boolean;
  saving: boolean;
  editing: boolean;
  grabbedId: string | null;
  pendingPlaceType: DashboardWidgetType | null;
  canvasNode: HTMLElement | null;
  width: number;
  resetAudience: "mentor" | "student";
  loadHome: (id: string, preferredBoardId?: string | null) => Promise<void>;
  loadSnapshot: LoadSnapshot;
  grabBaseRef: MutableRefObject<DashboardWidgetLayout[] | null>;
  setLayout: Dispatch<SetStateAction<DashboardWidgetLayout[]>>;
  setBoard: Dispatch<SetStateAction<BoardState | null>>;
  setBoards: Dispatch<SetStateAction<BoardMeta[]>>;
  setScope: Dispatch<SetStateAction<"personal" | "org">>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setMessageKind: Dispatch<SetStateAction<"success" | "error">>;
  setAnnounce: Dispatch<SetStateAction<string>>;
  setGrabbedId: Dispatch<SetStateAction<string | null>>;
  setEditing: Dispatch<SetStateAction<boolean>>;
  setPreviewing: Dispatch<SetStateAction<boolean>>;
  setLibraryOpen: Dispatch<SetStateAction<boolean>>;
  setPendingPlaceType: Dispatch<SetStateAction<DashboardWidgetType | null>>;
  setBoardsOpen: Dispatch<SetStateAction<boolean>>;
  setRenameId: Dispatch<SetStateAction<string | null>>;
  setRenameDraft: Dispatch<SetStateAction<string>>;
}) {
  const {
    orgId,
    userId,
    board,
    boards,
    layout,
    layoutRef,
    displayLayout,
    cols,
    canShareOrg,
    saving,
    editing,
    grabbedId,
    pendingPlaceType,
    canvasNode,
    width,
    resetAudience,
    loadHome,
    loadSnapshot,
    grabBaseRef,
    setLayout,
    setBoard,
    setBoards,
    setScope,
    setSaving,
    setMessage,
    setMessageKind,
    setAnnounce,
    setGrabbedId,
    setEditing,
    setPreviewing,
    setLibraryOpen,
    setPendingPlaceType,
    setBoardsOpen,
    setRenameId,
    setRenameDraft,
  } = input;

  function requestPlaceWidget(
    entry: WidgetCatalogEntry,
    tapToPlace: boolean,
    closeLibrary = false,
  ) {
    if (tapToPlace) {
      setPendingPlaceType(entry.type);
      if (closeLibrary) setLibraryOpen(false);
      setMessageKind("success");
      setMessage(`Tap a slot on the board to place ${entry.label}.`);
      setAnnounce(`Tap a slot on the board to place ${entry.label}.`);
      return;
    }
    addWidget(entry.type);
  }

  function addWidget(type: DashboardWidgetType, drop?: GridCell, displayCols?: number) {
    const result = dropWidgetOntoLayout(layoutRef.current, type, {
      drop: drop ? { x: drop.col, y: drop.row } : undefined,
      displayCols: displayCols ?? DASHBOARD_COLUMNS,
      now: Date.now(),
    });
    if (!result.ok) {
      setMessageKind("error");
      setMessage(result.error);
      return;
    }
    const entry = catalogEntry(type);
    setLayout(compactLayout(result.layout, DASHBOARD_COLUMNS));
    setMessageKind("success");
    setMessage(`${entry?.label ?? type} added to the board.`);
    setAnnounce(`${entry?.label ?? type} added to the board.`);
    setLibraryOpen(false);
    setPendingPlaceType(null);
    if (orgId) void loadSnapshot(orgId, result.layout.map((item) => item.type));
  }

  function placePendingAtPoint(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) {
    if (!pendingPlaceType || !canvasNode) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("a, input, select, textarea, .dash-widget-card, [data-dash-widget]")) return;
    const spec = resolveGrid(width);
    const localCols = spec.cols;
    const localGap = spec.margin[0];
    const rect = canvasNode.getBoundingClientRect();
    const cell = pointToCell(
      { x: event.clientX, y: event.clientY },
      rect,
      localCols,
      spec.rowHeight,
      localGap,
    );
    addWidget(pendingPlaceType, { col: cell.col, row: cell.row }, localCols);
  }

  function tidyLayout() {
    setLayout((current) => packDashboardLayout(current));
    setMessageKind("success");
    setMessage("Widgets snapped upward into a clean, collision-free layout.");
    setAnnounce("Board tidied. Widgets snapped upward with no gaps.");
  }

  function setWidgetSize(id: string, size: WidgetSizeKey) {
    setLayout((current) => {
      const resized = current.map((item) => {
        if (item.i !== id) return item;
        return applyWidgetSize(item, size, catalogEntry(item.type));
      });
      return compactLayout(resized, DASHBOARD_COLUMNS);
    });
    const target = layoutRef.current.find((item) => item.i === id);
    const label = target ? catalogEntry(target.type)?.label ?? target.type : "Widget";
    setAnnounce(`${label} resized to ${WIDGET_SIZE_LABEL[size]}.`);
  }

  /** Back to the size the catalog ships this widget at — its designed shape. */
  function resetWidgetSize(id: string) {
    const target = layoutRef.current.find((item) => item.i === id);
    const entry = target ? catalogEntry(target.type) : undefined;
    if (!target || !entry) return;
    setLayout((current) => {
      const resized = current.map((item) =>
        item.i === id
          ? {
              ...item,
              w: entry.defaultW,
              h: entry.defaultH,
              minW: entry.minW,
              minH: entry.minH,
              x: Math.max(0, Math.min(DASHBOARD_COLUMNS - entry.defaultW, item.x)),
            }
          : item,
      );
      return compactLayout(resized, DASHBOARD_COLUMNS);
    });
    const label = entry.label ?? target.type;
    setAnnounce(`${label} reset to its default size.`);
  }

  function removeWidget(id: string) {
    const removed = layoutRef.current.find((item) => item.i === id);
    setLayout((current) => compactLayout(current.filter((item) => item.i !== id), DASHBOARD_COLUMNS));
    const label = removed ? catalogEntry(removed.type)?.label ?? removed.type : "Widget";
    setMessageKind("success");
    setMessage(`${label} removed. Tap Done to save, or add another from the palette.`);
    setAnnounce(`${label} removed from the board.`);
    if (grabbedId === id) setGrabbedId(null);
  }

  async function save(activateScope: "personal" | "org" = "personal") {
    if (!orgId) {
      setMessageKind("error");
      setMessage("Choose your team to save a custom layout.");
      return;
    }
    if (activateScope === "org" && !canShareOrg) {
      setMessageKind("error");
      setMessage("Ask a team admin to save a shared Home for the team.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const keepId = board?.id && board.scope === activateScope ? board.id : null;
      const name =
        keepId && board?.name
          ? board.name
          : activateScope === "org"
            ? "Team dashboard"
            : "My dashboard";
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          id: keepId,
          name,
          scope: activateScope,
          layout,
          activate: true,
          action: "save",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Save failed");
        return;
      }
      writeStoredBoardId(orgId, userId, data.id);
      setBoard({
        id: data.id,
        name: data.name,
        scope: data.scope,
        layout: data.layout,
      });
      setScope(data.scope);
      setLayout(data.layout);
      setEditing(false);
      setLibraryOpen(false);
      setGrabbedId(null);
      setMessageKind("success");
      setMessage(data.scope === "org" ? "Saved as team Home Screen." : "Personal Home Screen saved.");
      setPreviewing(false);
      await loadHome(orgId, data.id);
    } finally {
      setSaving(false);
    }
  }

  async function switchBoard(targetId: string) {
    if (!orgId || !targetId || targetId === board?.id || saving || editing) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, id: targetId, action: "activate" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Could not switch boards");
        return;
      }
      writeStoredBoardId(orgId, userId, data.id);
      setBoard({
        id: data.id,
        name: data.name,
        scope: data.scope,
        layout: data.layout,
      });
      setScope(data.scope);
      setLayout(layoutOrAudienceDefault(data.layout, resetAudience));
      setBoardsOpen(false);
      setMessageKind("success");
      setMessage(`Switched to ${data.name}`);
      await loadHome(orgId, data.id);
    } finally {
      setSaving(false);
    }
  }

  async function createBoard(createScope: "personal" | "org") {
    if (!orgId) return;
    if (createScope === "org" && !canShareOrg) {
      setMessageKind("error");
      setMessage("Ask a team admin to create a shared Home for the team.");
      return;
    }
    const personalCount = boards.filter((item) => item.scope === "personal").length;
    const orgCount = boards.filter((item) => item.scope === "org").length;
    const label =
      createScope === "org" ? `Team board ${orgCount + 1}` : `Board ${personalCount + 1}`;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          name: label,
          scope: createScope,
          activate: true,
          action: "create",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Could not create board");
        return;
      }
      writeStoredBoardId(orgId, userId, data.id);
      setEditing(true);
      setBoardsOpen(false);
      setMessageKind("success");
      setMessage(`Created ${data.name}. Arrange widgets, then Done.`);
      await loadHome(orgId, data.id);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Copies any board the member can see into a new personal board. This is how a
   * student starts from the team layout without the risk of editing the shared
   * one — the server rejects the copy if they are already at the board cap.
   */
  async function duplicateBoard(targetId: string) {
    if (!orgId || !targetId || saving || editing) return;
    const source = boards.find((item) => item.id === targetId);
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          id: targetId,
          name: source
            ? duplicateBoardName(
                source.name,
                boards.map((item) => item.name),
              )
            : undefined,
          scope: "personal",
          activate: true,
          action: "duplicate",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Could not duplicate board");
        return;
      }
      writeStoredBoardId(orgId, userId, data.id);
      setRenameId(null);
      setBoardsOpen(false);
      setMessageKind("success");
      setMessage(`Duplicated to ${data.name}. It is yours to edit.`);
      await loadHome(orgId, data.id);
    } finally {
      setSaving(false);
    }
  }

  async function renameBoard(targetId: string, nextName: string) {
    if (!orgId || !targetId) return;
    const name = nextName.trim().slice(0, 80);
    if (!name) {
      setMessageKind("error");
      setMessage("Board name cannot be empty.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, id: targetId, name, action: "rename" }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Rename failed");
        return;
      }
      setRenameId(null);
      setRenameDraft("");
      if (board?.id === targetId) setBoard((current) => (current ? { ...current, name: data.name } : current));
      setBoards((current) => current.map((item) => (item.id === targetId ? { ...item, name: data.name } : item)));
      setMessageKind("success");
      setMessage(`Renamed to ${data.name}`);
    } finally {
      setSaving(false);
    }
  }

  async function deleteBoard(targetId: string) {
    if (!orgId || !targetId) return;
    const target = boards.find((item) => item.id === targetId);
    if (!target) return;
    if (target.scope === "org" && !canShareOrg) {
      setMessageKind("error");
      setMessage("Ask a team admin to delete a shared Home.");
      return;
    }
    if (!window.confirm(`Delete “${target.name}”? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/dashboards", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, id: targetId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Delete failed");
        return;
      }
      if (board?.id === targetId) writeStoredBoardId(orgId, userId, data.activatedId ?? null);
      setRenameId(null);
      setMessageKind("success");
      setMessage(`Deleted ${target.name}`);
      await loadHome(orgId, data.activatedId ?? null);
    } finally {
      setSaving(false);
    }
  }

  function cancelEditing() {
    setLayout(layoutOrAudienceDefault(board?.layout, resetAudience));
    setEditing(false);
    setPreviewing(false);
    setLibraryOpen(false);
    setGrabbedId(null);
    setMessage("");
  }

  function enterEditMode() {
    setEditing(true);
    setPreviewing(false);
    setLibraryOpen(false);
    setMessageKind("success");
    setMessage(
      "Edit mode — press and hold a card (or use its grip) to move it, arrow keys reorder from the keyboard, and Remove clears a card.",
    );
  }

  async function resetDefault() {
    if (!orgId) {
      setLayout(defaultDashboardLayoutForAudience(resetAudience));
      setEditing(false);
      setLibraryOpen(false);
      setMessageKind("success");
      setMessage("Restored default home layout.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          id: board?.id,
          action: "reset",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessageKind("error");
        setMessage(data.error ?? "Reset failed");
        return;
      }
      const nextLayout = layoutOrAudienceDefault(
        Array.isArray(data.layout) ? data.layout : null,
        resetAudience,
      );
      setLayout(nextLayout);
      setBoard((current) => (current ? { ...current, layout: nextLayout } : current));
      setMessageKind("success");
      setMessage("Reset to default home widgets.");
      setEditing(false);
      setPreviewing(false);
      setLibraryOpen(false);
      if (orgId) await loadSnapshot(orgId, nextLayout.map((item) => item.type), { fullContext: true });
    } finally {
      setSaving(false);
    }
  }

  function commitNudge(item: DashboardWidgetLayout, direction: NudgeDirection) {
    const label = catalogEntry(item.type)?.label ?? item.type;
    const nextDisplay = nudgeItem(displayLayout, item.i, direction, cols);
    const moved = nextDisplay.find((entry) => entry.i === item.i);
    if (!moved || (moved.x === item.x && moved.y === item.y)) {
      setAnnounce(`${label} is already at the ${direction === "left" || direction === "right" ? "edge" : direction === "up" ? "top" : "bottom"} of the board.`);
      return;
    }
    setLayout(
      cols === 1
        ? reorderLayout(layoutRef.current, layoutOrder(nextDisplay))
        : applyGridDrag(layoutRef.current, nextDisplay, cols),
    );
    setAnnounce(`${describeCellMove(label, { col: moved.x, row: moved.y })}.`);
  }

  function onHandleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, item: DashboardWidgetLayout) {
    if (!editing) return;
    const label = catalogEntry(item.type)?.label ?? item.type;

    if (event.key === " " || event.key === "Spacebar" || event.key === "Enter") {
      event.preventDefault();
      if (grabbedId === item.i) {
        setGrabbedId(null);
        grabBaseRef.current = null;
        setAnnounce(`${label} dropped at row ${item.y + 1}, column ${item.x + 1}.`);
      } else {
        setGrabbedId(item.i);
        grabBaseRef.current = layoutRef.current;
        setAnnounce(
          `${label} picked up at row ${item.y + 1}, column ${item.x + 1}. Arrow keys move it, space drops it, escape cancels.`,
        );
      }
      return;
    }

    if (event.key === "Escape") {
      if (grabbedId !== item.i) return;
      event.preventDefault();
      if (grabBaseRef.current) setLayout(grabBaseRef.current);
      grabBaseRef.current = null;
      setGrabbedId(null);
      setAnnounce(`${label} move cancelled.`);
      return;
    }

    const direction = ARROW_DIRECTION[event.key];
    if (!direction || grabbedId !== item.i) return;
    event.preventDefault();
    commitNudge(item, direction);
  }

  return {
    addWidget,
    requestPlaceWidget,
    placePendingAtPoint,
    tidyLayout,
    setWidgetSize,
    resetWidgetSize,
    removeWidget,
    save,
    switchBoard,
    createBoard,
    duplicateBoard,
    renameBoard,
    deleteBoard,
    cancelEditing,
    enterEditMode,
    resetDefault,
    onHandleKeyDown,
  };
}
