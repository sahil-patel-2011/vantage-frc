"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  homeViewLayout,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
} from "../../lib/dashboard/catalog";
import { displayBoard, fitPhoneRows } from "../../lib/dashboard/board-order";
import {
  cellBox,
  layoutBottom,
} from "../../lib/dashboard/grid-drag";
import {
  classifyDashboardShell,
  dashboardNextActions,
  dashboardSetupSteps,
} from "../../lib/dashboard/dashboard-related";
import { editBoardLayout, hiddenOnHome, layoutForEditing } from "../../lib/dashboard/edit-mode";
import type { DataSourceHealthView } from "../../lib/reference-health";
import { strategyCanSync } from "../../lib/strategy/strategy-related";
import {
  resolveGrid,
  useMeasuredCanvas,
} from "./dashboard-canvas";
import { prioritizeHomeStrip, type HomeStripItem } from "../../lib/home-workflows";
import { useVenueShortcuts } from "../../hooks/use-venue-shortcuts";
import { useDashboardPointerDrag } from "./use-dashboard-pointer-drag";
import { useDashboardBoardOps } from "./use-dashboard-board-ops";
import { useDashboardHomeState } from "./use-dashboard-home-state";
import { useDashboardEditHistory } from "./use-dashboard-edit-history";
import {
  dashboardBoardLists,
  dashboardPaletteRows,
} from "./dashboard-home-model";
import { DashboardHomeView } from "./dashboard-home-view";
import { DashboardActionsProvider } from "./dashboard-quick-actions";
import { setupHeroFrom, useFirstWeek } from "./first-week-card";
import { WidgetsLoadedContext } from "./widgets/widgets-loaded";
import { usePhoneCardRows } from "./use-phone-card-rows";
import "./dashboard-dnd.css";
import "./dash-layout.css";

export default function DashboardClient({ initialOrgId = "" }: { initialOrgId?: string }) {
  const { setNode: setCanvasNode, node: canvasNode, width, mounted, measured } = useMeasuredCanvas();
  const home = useDashboardHomeState(initialOrgId);
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(home.orgId || null);

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
    loaded: (home.meLoaded && !home.meFailed) || Boolean(home.orgId && home.updatedAt),
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

  // The member's onboarding steps. While the team's own setup is unfinished, its next
  // step is Home's hero and Home's only setup list.
  const firstWeek = useFirstWeek(home.orgId);
  const setupHero = useMemo(() => setupHeroFrom(firstWeek.view), [firstWeek.view]);
  const teamSetupCard = Boolean(setupHero);
  /** Session and the team's real board are here; before that Home is one skeleton. */
  const homeReady = home.meLoaded && (!home.orgId || home.boardLoaded);
  /*
    Cards added during this edit. They stay on the board while you edit even
    if Home would hide them for being empty, so tapping a widget always puts
    something you can see on the board.
  */
  const [addedThisEdit, setAddedThisEdit] = useState<ReadonlySet<string>>(() => new Set());
  // Preview turns editing off for a moment; the edit session (and what it added) lasts until
  // Done or Cancel, the same rule the undo history uses.
  useEffect(() => {
    if (!home.editing && !home.previewing) setAddedThisEdit(new Set());
  }, [home.editing, home.previewing]);
  const markAdded = useCallback((id: string) => {
    setAddedThisEdit((current) => new Set(current).add(id));
  }, []);

  const grid = resolveGrid(width);
  const gap = grid.margin[0];
  const cols = grid.cols;
  const canvasWidth = width;

  /*
    Cards the normal Home leaves out right now. Edit mode lists them in one
    row under the board rather than painting them as full-size dimmed cards —
    those pushed the real board a screen down.
  */
  const hiddenFor = useCallback(
    (layout: DashboardWidgetLayout[]) => hiddenOnHome(layout, { shell: dashShell, widgets: home.widgets, teamSetupCard }),
    [dashShell, home.widgets, teamSetupCard],
  );
  const hiddenOnHomeIds = useMemo(() => hiddenFor(home.layout), [hiddenFor, home.layout]);
  const paletteEntries = useMemo(
    () => dashboardPaletteRows(home.layout, home.role, { hidden: hiddenOnHomeIds, widgets: home.widgets }),
    [home.layout, home.role, hiddenOnHomeIds, home.widgets],
  );
  const widgetsRef = useRef(home.widgets);
  useEffect(() => {
    widgetsRef.current = home.widgets;
  }, [home.widgets]);
  const widgetStatus = useCallback((type: DashboardWidgetType) => widgetsRef.current[type]?.status, []);

  /*
    Opening the widget sheet fetches what the widgets not on the board would
    show, so the sheet can mark "Empty right now" before you add one.
  */
  const { libraryOpen, orgId: homeOrgId, loadSnapshot } = home;
  const paletteRef = useRef(paletteEntries);
  useEffect(() => {
    paletteRef.current = paletteEntries;
  }, [paletteEntries]);
  useEffect(() => {
    if (!libraryOpen || !homeOrgId) return;
    const missing = paletteRef.current
      .filter((row) => row.status === "add" && !widgetsRef.current[row.entry.type])
      .map((row) => row.entry.type);
    if (missing.length) void loadSnapshot(homeOrgId, missing).catch(() => undefined);
  }, [libraryOpen, homeOrgId, loadSnapshot]);
  const viewFor = useCallback(
    (layout: DashboardWidgetLayout[], editing: boolean) =>
      editing
        ? editBoardLayout(layout, hiddenFor(layout), addedThisEdit, home.widgets)
        : homeViewLayout(layout, { editing: false, shell: dashShell, widgets: home.widgets, teamSetupCard }),
    [hiddenFor, addedThisEdit, dashShell, home.widgets, teamSetupCard],
  );
  const viewLayout = useMemo(() => viewFor(home.layout, home.editing), [viewFor, home.layout, home.editing]);
  const settle = useCallback(
    (layout: DashboardWidgetLayout[]) => {
      const hidden = new Map([...hiddenFor(layout)].filter(([id]) => !addedThisEdit.has(id)));
      return layoutForEditing(layout, hidden);
    },
    [hiddenFor, addedThisEdit],
  );

  /*
    What is actually painted: the 12-column board packed the way Home packs it,
    then shown on this screen's columns in the same reading order. Edit mode,
    Preview and Home all go through this, so they always agree.
  */
  // A phone's edit board sizes each card to what it showed on Home, so editing never clips one.
  const phoneRows = usePhoneCardRows({
    canvasNode,
    active: cols === 1 && !home.editing && !home.previewing,
    rowHeight: grid.rowHeight,
    gap,
  });
  const displayFor = useCallback(
    (layout: DashboardWidgetLayout[]) => fitPhoneRows(displayBoard(viewFor(layout, true), cols), cols, phoneRows),
    [viewFor, cols, phoneRows],
  );
  const displayLayout = useMemo(
    () => (home.editing ? fitPhoneRows(displayBoard(viewLayout, cols), cols, phoneRows) : displayBoard(viewLayout, cols)),
    [viewLayout, cols, home.editing, phoneRows],
  );

  useEffect(() => {
    home.displayRef.current = displayLayout;
  }, [displayLayout, home.displayRef]);

  const layoutRef = home.layoutRef;
  const currentLayout = useCallback(() => layoutRef.current, [layoutRef]);
  const history = useDashboardEditHistory({
    editing: home.editing,
    previewing: home.previewing,
    setLayout: home.setLayout,
    current: currentLayout,
  });
  const { setMessage, setMessageAction, setMessageKind, setAnnounce } = home;
  const undo = useCallback(() => {
    if (!history.undo()) return;
    setMessageKind("success");
    setMessageAction(null);
    setMessage("Undone.");
    setAnnounce("Undid the last change.");
  }, [history, setMessage, setMessageAction, setMessageKind, setAnnounce]);
  const redo = useCallback(() => {
    if (!history.redo()) return;
    setMessageKind("success");
    setMessageAction(null);
    setMessage("Redone.");
    setAnnounce("Put the change back.");
  }, [history, setMessage, setMessageAction, setMessageKind, setAnnounce]);
  const dismissMessage = useCallback(() => {
    setMessage("");
    setMessageAction(null);
  }, [setMessage, setMessageAction]);

  const gridRows = Math.max(layoutBottom(displayLayout), home.editing ? 4 : 1);
  const gridHeight = gridRows * grid.rowHeight + Math.max(0, gridRows - 1) * gap;

  const {
    addWidget,
    tidyLayout,
    setAlwaysShown,
    shareWithTeam,
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
    hasUnsavedChanges,
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
    displayFor,
    settle,
    previewing: home.previewing,
    resetAudience: homeAudience === "mentor" ? "mentor" : "student",
    loadHome: home.loadHome,
    loadSnapshot: home.loadSnapshot,
    record: history.record,
    grabBaseRef: home.grabBaseRef,
    setLayout: home.setLayout,
    setBoard: home.setBoard,
    setBoards: home.setBoards,
    setScope: home.setScope,
    setSaving: home.setSaving,
    setMessage: home.setMessage,
    setMessageKind: home.setMessageKind,
    setMessageAction: home.setMessageAction,
    setHighlightId: home.setHighlightId,
    setAnnounce: home.setAnnounce,
    setGrabbedId: home.setGrabbedId,
    setEditing: home.setEditing,
    setPreviewing: home.setPreviewing,
    setLibraryOpen: home.setLibraryOpen,
    onWidgetAdded: markAdded,
    widgetStatus,
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
    record: history.record,
    addWidget,
    setMessage: home.setMessage,
    setMessageKind: home.setMessageKind,
    setAnnounce: home.setAnnounce,
    setGrabbedId: home.setGrabbedId,
  });

  // ?customize=1 opens edit mode once the real board is here, never on the placeholder.
  const { pendingCustomize, setPendingCustomize } = home;
  const enterEditRef = useRef(enterEditMode);
  useEffect(() => {
    enterEditRef.current = enterEditMode;
  });
  useEffect(() => {
    if (!pendingCustomize || !homeReady) return;
    setPendingCustomize(false);
    enterEditRef.current();
  }, [pendingCustomize, homeReady, setPendingCustomize]);

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
    <DashboardActionsProvider orgId={home.orgId} refresh={(type) => home.loadSnapshot(home.orgId, [type])}>
    <WidgetsLoadedContext.Provider value={home.widgetsLoaded}>
    <DashboardHomeView
      setupHero={setupHero}
      firstWeek={firstWeek}
      role={home.role}
      homeReady={homeReady}
      me={home.me}
      meLoaded={home.meLoaded}
      orgId={home.orgId}
      board={home.board}
      switcherBoards={switcherBoards}
      personalBoards={personalBoards}
      orgBoards={orgBoards}
      layout={home.layout}
      viewLayout={viewLayout}
      displayLayout={displayLayout}
      widgets={home.widgets}
      // Whether the widgets (and the onboarding steps) have arrived, so the "what to do
      // now" card waits as a blank shape rather than saying there is nothing.
      widgetsLoaded={home.widgetsLoaded && firstWeek.loaded}
      paletteEntries={paletteEntries}
      hiddenOnHome={hiddenOnHomeIds}
      homeStripItems={homeStripItems}
      homeAudience={homeAudience}
      nextMatchData={nextMatchData}
      dashShell={dashShell}
      nextActions={nextActions}
      setupSteps={setupSteps}
      dataSourceHealth={dataSourceHealth}
      canOpenTeamData={strategyCanSync(home.role)}
      tbaConfigured={tbaConfigured}
      setupRequired={setupRequired}
      eventName={home.context.eventName}
      editing={home.editing}
      previewing={home.previewing}
      libraryOpen={home.libraryOpen}
      saving={home.saving}
      canShareOrg={home.canShareOrg}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
      boardsOpen={home.boardsOpen}
      renameId={home.renameId}
      renameDraft={home.renameDraft}
      grabbedId={home.grabbedId}
      highlightId={home.highlightId}
      message={home.message}
      messageKind={home.messageKind}
      messageAction={home.messageAction}
      onRetrySession={home.meFailed && !home.orgId ? home.retryMe : null}
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
      setHighlightId={home.setHighlightId}
      dismissMessage={dismissMessage}
      enterEditMode={enterEditMode}
      cancelEditing={cancelEditing}
      hasUnsavedChanges={hasUnsavedChanges}
      undo={undo}
      redo={redo}
      tidyLayout={tidyLayout}
      save={save}
      resetDefault={resetDefault}
      switchBoard={switchBoard}
      createBoard={createBoard}
      duplicateBoard={duplicateBoard}
      renameBoard={renameBoard}
      deleteBoard={deleteBoard}
      addWidget={addWidget}
      setAlwaysShown={setAlwaysShown}
      shareWithTeam={shareWithTeam}
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
    </WidgetsLoadedContext.Provider>
    </DashboardActionsProvider>
  );
}
