"use client";

import { useEffect, useMemo } from "react";
import {
  DASHBOARD_COLUMNS,
  homeViewLayout,
  scaleLayoutToCols,
} from "../../lib/dashboard/catalog";
import {
  cellBox,
  compactLayout,
  layoutBottom,
} from "../../lib/dashboard/grid-drag";
import {
  classifyDashboardShell,
  dashboardNextActions,
  dashboardSetupSteps,
} from "../../lib/dashboard/dashboard-related";
import type { DataSourceHealthView } from "../../lib/reference-health";
import {
  resolveGrid,
  useMeasuredCanvas,
} from "./dashboard-canvas";
import { prioritizeHomeStrip, type HomeStripItem } from "../../lib/home-workflows";
import { useVenueShortcuts } from "../../hooks/use-venue-shortcuts";
import { useDashboardPointerDrag } from "./use-dashboard-pointer-drag";
import { useDashboardBoardOps } from "./use-dashboard-board-ops";
import { useDashboardHomeState } from "./use-dashboard-home-state";
import {
  dashboardBoardLists,
  dashboardPaletteRows,
} from "./dashboard-home-model";
import { DashboardHomeView } from "./dashboard-home-view";
import "./dashboard-dnd.css";

export default function DashboardClient({ initialOrgId = "" }: { initialOrgId?: string }) {
  const { setNode: setCanvasNode, node: canvasNode, width, mounted, measured } = useMeasuredCanvas();
  const home = useDashboardHomeState(initialOrgId);
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(home.orgId || null);

  const paletteEntries = useMemo(
    () => dashboardPaletteRows(home.layout, home.role),
    [home.layout, home.role],
  );
  const addableEntries = useMemo(
    () => paletteEntries.filter((row) => row.status === "add"),
    [paletteEntries],
  );
  const { personalBoards, orgBoards, switcherBoards } = useMemo(
    () => dashboardBoardLists(home.boards, home.board),
    [home.boards, home.board],
  );

  const tbaConfigured =
    typeof home.context.tbaConfigured === "boolean"
      ? home.context.tbaConfigured
      : typeof home.me.tbaConfigured === "boolean"
        ? home.me.tbaConfigured
        : undefined;
  const setupRequired = Boolean(home.context.setupRequired);
  const hasScoutingSchemas = Boolean(home.context.hasScoutingSchemas);
  const hasAiProvider = Boolean(home.context.hasAiProvider);
  const dataSourceHealth =
    home.context.dataSourceHealth && typeof home.context.dataSourceHealth === "object"
      ? (home.context.dataSourceHealth as DataSourceHealthView)
      : null;
  const homeStripRaw = home.context.homeStrip as
    | { audience?: string; items?: HomeStripItem[] }
    | undefined;
  const homeStripItems = prioritizeHomeStrip(
    Array.isArray(homeStripRaw?.items) ? homeStripRaw.items : [],
    3,
  );
  const homeAudience =
    homeStripRaw?.audience === "mentor" || homeStripRaw?.audience === "student"
      ? homeStripRaw.audience
      : null;
  const nextMatchPayload = home.widgets.next_match;
  const nextMatchData =
    nextMatchPayload?.status === "live" ? (nextMatchPayload.data as Record<string, unknown> | undefined) : undefined;
  const dashShell = classifyDashboardShell({
    loaded: home.meLoaded || Boolean(home.orgId && home.updatedAt),
    orgId: home.orgId || null,
    setupRequired,
    tbaConfigured,
  });
  home.shellRef.current = dashShell;
  const nextActions = dashboardNextActions({
    orgId: home.orgId || null,
    shell: dashShell,
    hasScoutingSchemas,
    hasAiProvider,
    role: home.role,
  });
  const setupSteps = dashboardSetupSteps({
    orgId: home.orgId || null,
    setupRequired,
    tbaConfigured,
    hasScoutingSchemas,
    hasAiProvider,
    role: home.role,
  });

  const viewLayout = useMemo(
    () => homeViewLayout(home.layout, { editing: home.editing, shell: dashShell, widgets: home.widgets }),
    [home.layout, home.editing, dashShell, home.widgets],
  );
  const grid = resolveGrid(width);
  const gap = grid.margin[0];
  const cols = grid.cols;
  const canvasWidth = width;

  /** What is actually painted: the saved 12-column board scaled to this screen. */
  const displayLayout = useMemo(
    () => compactLayout(scaleLayoutToCols(viewLayout, DASHBOARD_COLUMNS, cols), cols),
    [viewLayout, cols],
  );

  useEffect(() => {
    home.displayRef.current = displayLayout;
  }, [displayLayout, home.displayRef]);

  const gridRows = Math.max(layoutBottom(displayLayout), home.editing ? 4 : 1);
  const gridHeight = gridRows * grid.rowHeight + Math.max(0, gridRows - 1) * gap;

  const {
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
  } = useDashboardBoardOps({
    orgId: home.orgId,
    userId: home.userId,
    board: home.board,
    boards: home.boards,
    layout: home.layout,
    layoutRef: home.layoutRef,
    displayLayout,
    cols,
    canShareOrg: home.canShareOrg,
    saving: home.saving,
    editing: home.editing,
    grabbedId: home.grabbedId,
    pendingPlaceType: home.pendingPlaceType,
    canvasNode,
    width,
    resetAudience: homeAudience === "mentor" ? "mentor" : "student",
    loadHome: home.loadHome,
    loadSnapshot: home.loadSnapshot,
    grabBaseRef: home.grabBaseRef,
    setLayout: home.setLayout,
    setBoard: home.setBoard,
    setBoards: home.setBoards,
    setScope: home.setScope,
    setSaving: home.setSaving,
    setMessage: home.setMessage,
    setMessageKind: home.setMessageKind,
    setAnnounce: home.setAnnounce,
    setGrabbedId: home.setGrabbedId,
    setEditing: home.setEditing,
    setPreviewing: home.setPreviewing,
    setLibraryOpen: home.setLibraryOpen,
    setPendingPlaceType: home.setPendingPlaceType,
    setBoardsOpen: home.setBoardsOpen,
    setRenameId: home.setRenameId,
    setRenameDraft: home.setRenameDraft,
  });

  const {
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
  } = useDashboardPointerDrag({
    editing: home.editing,
    saving: home.saving,
    canvasNode,
    cols,
    gap,
    rowHeight: grid.rowHeight,
    canvasWidth,
    layoutRef: home.layoutRef,
    displayRef: home.displayRef,
    grabBaseRef: home.grabBaseRef,
    setLayout: home.setLayout,
    addWidget,
    setMessage: home.setMessage,
    setMessageKind: home.setMessageKind,
    setAnnounce: home.setAnnounce,
    setGrabbedId: home.setGrabbedId,
  });

  // The ghost is positioned imperatively (transform is never in the style prop),
  // so re-renders during a drag never yank it back to the last committed point.
  useEffect(() => {
    if (drag) paintProxy();
  }, [drag]);

  const dropBox =
    drag && drag.kind === "add"
      ? cellBox({ x: drag.cell.col, y: drag.cell.row, ...drag.span }, canvasWidth, cols, grid.rowHeight, gap)
      : null;

  return (
    <DashboardHomeView
      me={home.me}
      meLoaded={home.meLoaded}
      orgId={home.orgId}
      board={home.board}
      scope={home.scope}
      switcherBoards={switcherBoards}
      personalBoards={personalBoards}
      orgBoards={orgBoards}
      layout={home.layout}
      viewLayout={viewLayout}
      displayLayout={displayLayout}
      widgets={home.widgets}
      paletteEntries={paletteEntries}
      addableEntries={addableEntries}
      homeStripItems={homeStripItems}
      homeAudience={homeAudience}
      nextMatchData={nextMatchData}
      dashShell={dashShell}
      nextActions={nextActions}
      setupSteps={setupSteps}
      dataSourceHealth={dataSourceHealth}
      tbaConfigured={tbaConfigured}
      setupRequired={setupRequired}
      eventName={home.context.eventName}
      editing={home.editing}
      previewing={home.previewing}
      libraryOpen={home.libraryOpen}
      pendingPlaceType={home.pendingPlaceType}
      saving={home.saving}
      canShareOrg={home.canShareOrg}
      boardsOpen={home.boardsOpen}
      renameId={home.renameId}
      renameDraft={home.renameDraft}
      grabbedId={home.grabbedId}
      message={home.message}
      messageKind={home.messageKind}
      announce={home.announce}
      updatedAt={home.updatedAt}
      fromCache={home.fromCache}
      cachedAt={home.cachedAt}
      mounted={mounted}
      measured={measured}
      width={width}
      canvasWidth={canvasWidth}
      cols={cols}
      gap={gap}
      grid={grid}
      gridHeight={gridHeight}
      dragging={dragging}
      drag={drag}
      snapFeedback={snapFeedback}
      dropBox={dropBox}
      cheatOpen={cheatOpen}
      shortcuts={shortcuts}
      proxyRef={proxyRef}
      suppressClickRef={suppressClickRef}
      setCanvasNode={setCanvasNode}
      setCheatOpen={setCheatOpen}
      setBoardsOpen={home.setBoardsOpen}
      setRenameId={home.setRenameId}
      setRenameDraft={home.setRenameDraft}
      setEditing={home.setEditing}
      setPreviewing={home.setPreviewing}
      setLibraryOpen={home.setLibraryOpen}
      enterEditMode={enterEditMode}
      cancelEditing={cancelEditing}
      tidyLayout={tidyLayout}
      save={save}
      resetDefault={resetDefault}
      switchBoard={switchBoard}
      createBoard={createBoard}
      duplicateBoard={duplicateBoard}
      renameBoard={renameBoard}
      deleteBoard={deleteBoard}
      addWidget={addWidget}
      requestPlaceWidget={requestPlaceWidget}
      placePendingAtPoint={placePendingAtPoint}
      removeWidget={removeWidget}
      setWidgetSize={setWidgetSize}
      resetWidgetSize={resetWidgetSize}
      onHandleKeyDown={onHandleKeyDown}
      beginCardDrag={beginCardDrag}
      beginPaletteDrag={beginPaletteDrag}
      onDragPointerMove={onDragPointerMove}
      onDragPointerUp={onDragPointerUp}
      onDragPointerCancel={onDragPointerCancel}
    />
  );
}
