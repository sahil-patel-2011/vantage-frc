"use client";

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from "react";
import dynamic from "next/dynamic";
import { prefersTapToPlace } from "../../lib/dashboard/tap-to-place";
import {
  catalogEntry,
  inferWidgetSize,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type WidgetCatalogEntry,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import { cellBox } from "../../lib/dashboard/grid-drag";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import {
  type DashboardNextAction,
  type DashboardSetupStep,
  type DashboardShellKind,
} from "../../lib/dashboard/dashboard-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { Icon } from "../../components/icon";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
import type { DataSourceHealthView } from "../../lib/reference-health";
import { DashboardGridItem } from "./dashboard-grid-item";
import { LiveCountdown } from "./widgets";
import { WIDGET_PICKER_ICON, greeting, homeQuickStart } from "./dashboard-canvas";
import type { HomeStripItem } from "../../lib/home-workflows";
import { Button } from "../../components/ui";
import type {
  BoardMeta,
  BoardState,
  DragView,
  Me,
  PaletteRow,
  SnapFeedback,
} from "./dashboard-board-types";
import { DashboardBoardBar } from "./dashboard-board-bar";
import { DashboardSetupBanner } from "./dashboard-setup-banner";
import { CopyShareLink } from "../../components/copy-share-link";
import { VenueShortcutCheatsheet, type VenueShortcut } from "../../hooks/use-venue-shortcuts";
import { homeHeaderDetail } from "./dashboard-home-model";

const DashboardBoardsModal = dynamic(
  () => import("./dashboard-boards-modal").then((mod) => mod.DashboardBoardsModal),
  { ssr: false },
);
const DashboardEditDock = dynamic(
  () => import("./dashboard-edit-dock").then((mod) => mod.DashboardEditDock),
  { ssr: false },
);
const DashboardPreviewDock = dynamic(
  () => import("./dashboard-edit-dock").then((mod) => mod.DashboardPreviewDock),
  { ssr: false },
);
const DashboardWidgetLibrary = dynamic(
  () => import("./dashboard-widget-library").then((mod) => mod.DashboardWidgetLibrary),
  { ssr: false },
);
const DashboardWidgetPalette = dynamic(
  () => import("./dashboard-widget-palette").then((mod) => mod.DashboardWidgetPalette),
  { ssr: false },
);
const PartnerPlacement = dynamic(() => import("../../components/partner-placement"), {
  ssr: false,
});

type GridSpec = {
  label: string;
  cols: number;
  rowHeight: number;
};

export function DashboardHomeView(props: {
  me: Me;
  meLoaded: boolean;
  orgId: string;
  board: BoardState | null;
  scope: "personal" | "org";
  switcherBoards: BoardMeta[];
  personalBoards: BoardMeta[];
  orgBoards: BoardMeta[];
  layout: DashboardWidgetLayout[];
  viewLayout: DashboardWidgetLayout[];
  displayLayout: DashboardWidgetLayout[];
  widgets: Record<string, WidgetPayload>;
  paletteEntries: PaletteRow[];
  addableEntries: PaletteRow[];
  homeStripItems: HomeStripItem[];
  homeAudience: "mentor" | "student" | null;
  nextMatchData: Record<string, unknown> | undefined;
  dashShell: DashboardShellKind;
  nextActions: DashboardNextAction[];
  setupSteps: DashboardSetupStep[];
  dataSourceHealth: DataSourceHealthView | null;
  tbaConfigured: boolean | undefined;
  setupRequired: boolean;
  eventName: unknown;
  editing: boolean;
  previewing: boolean;
  libraryOpen: boolean;
  pendingPlaceType: DashboardWidgetType | null;
  saving: boolean;
  canShareOrg: boolean;
  boardsOpen: boolean;
  renameId: string | null;
  renameDraft: string;
  grabbedId: string | null;
  message: string;
  messageKind: "success" | "error";
  announce: string;
  updatedAt: string | null;
  fromCache: boolean;
  cachedAt: string | null;
  mounted: boolean;
  measured: boolean;
  width: number;
  canvasWidth: number;
  cols: number;
  gap: number;
  grid: GridSpec;
  gridHeight: number;
  dragging: boolean;
  drag: DragView | null;
  snapFeedback: SnapFeedback | null;
  dropBox: { left: number; top: number; width: number; height: number } | null;
  cheatOpen: boolean;
  shortcuts: VenueShortcut[];
  proxyRef: Ref<HTMLDivElement>;
  suppressClickRef: { current: boolean };
  setCanvasNode: (node: HTMLDivElement | null) => void;
  setCheatOpen: (open: boolean) => void;
  setBoardsOpen: (open: boolean) => void;
  setRenameId: (id: string | null) => void;
  setRenameDraft: (name: string) => void;
  setEditing: (editing: boolean) => void;
  setPreviewing: (previewing: boolean) => void;
  setLibraryOpen: (open: boolean | ((open: boolean) => boolean)) => void;
  enterEditMode: () => void;
  cancelEditing: () => void;
  tidyLayout: () => void;
  save: (scope?: "personal" | "org") => Promise<void> | void;
  resetDefault: () => Promise<void> | void;
  switchBoard: (id: string) => Promise<void> | void;
  createBoard: (scope: "personal" | "org") => Promise<void> | void;
  duplicateBoard: (id: string) => Promise<void> | void;
  renameBoard: (id: string, name: string) => Promise<void> | void;
  deleteBoard: (id: string) => Promise<void> | void;
  addWidget: (type: DashboardWidgetType) => void;
  requestPlaceWidget: (entry: WidgetCatalogEntry, tapToPlace: boolean, closeLibrary?: boolean) => void;
  placePendingAtPoint: (event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) => void;
  removeWidget: (id: string) => void;
  setWidgetSize: (id: string, size: WidgetSizeKey) => void;
  resetWidgetSize: (id: string) => void;
  onHandleKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, item: DashboardWidgetLayout) => void;
  beginCardDrag: (
    event: ReactPointerEvent<HTMLElement>,
    item: DashboardWidgetLayout,
    activation: "immediate" | "longpress",
  ) => void;
  beginPaletteDrag: (event: ReactPointerEvent<HTMLElement>, entry: WidgetCatalogEntry) => void;
  onDragPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onDragPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const {
    me,
    meLoaded,
    orgId,
    board,
    scope,
    switcherBoards,
    personalBoards,
    orgBoards,
    layout,
    viewLayout,
    displayLayout,
    widgets,
    paletteEntries,
    addableEntries,
    homeStripItems,
    homeAudience,
    nextMatchData,
    dashShell,
    nextActions,
    setupSteps,
    dataSourceHealth,
    tbaConfigured,
    setupRequired,
    eventName,
    editing,
    previewing,
    libraryOpen,
    pendingPlaceType,
    saving,
    canShareOrg,
    boardsOpen,
    renameId,
    renameDraft,
    grabbedId,
    message,
    messageKind,
    announce,
    updatedAt,
    fromCache,
    cachedAt,
    mounted,
    measured,
    width,
    canvasWidth,
    cols,
    gap,
    grid,
    gridHeight,
    dragging,
    drag,
    snapFeedback,
    dropBox,
    cheatOpen,
    shortcuts,
    proxyRef,
    suppressClickRef,
    setCanvasNode,
    setCheatOpen,
    setBoardsOpen,
    setRenameId,
    setRenameDraft,
    setEditing,
    setPreviewing,
    setLibraryOpen,
    enterEditMode,
    cancelEditing,
    tidyLayout,
    save,
    resetDefault,
    switchBoard,
    createBoard,
    duplicateBoard,
    renameBoard,
    deleteBoard,
    addWidget,
    requestPlaceWidget,
    placePendingAtPoint,
    removeWidget,
    setWidgetSize,
    resetWidgetSize,
    onHandleKeyDown,
    beginCardDrag,
    beginPaletteDrag,
    onDragPointerMove,
    onDragPointerUp,
    onDragPointerCancel,
  } = props;

  const firstName = (me.name ?? "coach").split(" ")[0] || "coach";
  const boardIsEmpty = layout.length === 0;
  const quickStart = homeQuickStart(orgId || null);

  return (
    <main className={`dash-home${editing ? " is-editing" : ""}`} data-grid={grid.label} data-cols={cols}>
      <p className="dash-live-region" role="status" aria-live="polite">
        {announce}
      </p>

      <header className="dash-home-header">
        <div>
          <span className="breadcrumbs">
            {me.orgName ?? "Your team"} {me.teamNumber ? `· ${me.teamNumber}` : ""}
            {board && !board.isDefault ? (
              <span className="dash-scope-pill" data-scope={scope}>
                {scope === "org" ? "Team board" : "Personal board"}
              </span>
            ) : null}
          </span>
          <h1>
            {greeting()}, {firstName}
          </h1>
          {orgId && board && !board.isDefault && switcherBoards.length > 1 ? (
            <p className="dash-board-current">
              <strong>{board.name}</strong>
            </p>
          ) : null}
          <p>
            {homeHeaderDetail({
              meLoaded,
              orgId,
              tbaConfigured,
              setupRequired,
              eventName,
            })}
          </p>
        </div>
        <div className="dash-home-actions">
          {nextMatchData && !editing && !viewLayout.some((item) => item.type === "next_match") ? (
            <a className="dash-next-glance" href={withOrgHref("/intel", orgId || null)}>
              <span>Next</span>
              <strong>
                {String(nextMatchData.compLevel ?? "Match").toUpperCase()} {String(nextMatchData.matchNumber ?? "")}
              </strong>
              <b>
                <LiveCountdown iso={nextMatchData.scheduledTime as string | undefined} />
              </b>
            </a>
          ) : null}
          {!orgId ? (
            <Button as="a" variant="secondary" href="/workspace">
              Choose your team
            </Button>
          ) : (setupRequired || tbaConfigured === false) && dashShell === "ready" ? (
            // The first-run banner below already carries this action; showing
            // it here too was the third "Connect TBA" on one screen.
            <Button
              as="a"
              variant="secondary"
              href={
                tbaConfigured === false
                  ? withOrgHref("/team/data", orgId)
                  : hubHref("/competition", "command", orgId)
              }
            >
              {tbaConfigured === false ? "Connect TBA" : "Set active event"}
            </Button>
          ) : null}
          {!editing && !previewing ? (
            <Button
              variant="secondary"
              className="dash-edit-trigger"
              data-testid="dash-customize"
              aria-label="Edit Home — rearrange, add, or remove widgets"
              onClick={enterEditMode}
            >
              Edit Home
            </Button>
          ) : null}
          <details className="dash-home-more">
            <summary aria-label="More home tools">More</summary>
            <div>
              <CopyShareLink orgId={orgId || null} />
              {orgId && meLoaded && !editing ? (
                <button
                  type="button"
                  className="dash-board-manage"
                  data-testid="dash-manage-boards"
                  disabled={saving}
                  aria-expanded={boardsOpen}
                  onClick={() => {
                    setBoardsOpen(true);
                    setRenameId(null);
                  }}
                >
                  Manage boards
                </button>
              ) : null}
              {updatedAt && orgId && !editing && !fromCache ? (
                <small className="dash-updated">Synced · {new Date(updatedAt).toLocaleTimeString()}</small>
              ) : null}
            </div>
          </details>
        </div>
      </header>
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      {orgId && meLoaded && !editing ? (
        <nav className="dash-quick-start" aria-label="Quick start">
          <div className="dash-quick-start-heading">
            <strong>Jump back in</strong>
            <span>Four common team jobs, always one tap away</span>
          </div>
          <div className="dash-quick-start-links">
            {quickStart.map((item) => (
              <a key={item.id} href={item.href}>
                <i aria-hidden="true">
                  <Icon name={item.icon} />
                </i>
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <b aria-hidden="true">→</b>
              </a>
            ))}
          </div>
        </nav>
      ) : null}

      {/* Learning first. A new member's Home should point at the tracks that
          make them useful, not only at event-day tools they cannot use yet. */}
      {orgId && meLoaded && !editing ? (
        <nav className="dash-learn" aria-label="Start here">
          <div className="dash-learn-heading">
            <strong>Start here</strong>
            <span>The tracks every new member works through — and the profile the team already has</span>
          </div>
          <div className="dash-learn-links">
            <a href={withOrgHref("/dev-setup", orgId)}>
              <strong>Set up your laptop</strong>
              <small>Git, VS Code, WPILib, PathPlanner, GitHub — step by step</small>
            </a>
            <a href={withOrgHref("/cad-learn", orgId)}>
              <strong>Learn CAD</strong>
              <small>Onshape from the first sketch to a graded part</small>
            </a>
            <a href={withOrgHref("/files", orgId)}>
              <strong>Files</strong>
              <small>Team drive and your own private space</small>
            </a>
            <a href={withOrgHref("/team/profile", orgId)}>
              <strong>Team profile</strong>
              <small>Where we are from, seasons, awards, results</small>
            </a>
          </div>
        </nav>
      ) : null}

      {orgId && !editing && homeStripItems.length > 0 ? (
        <section
          className="dash-role-strip"
          data-audience={homeAudience ?? "student"}
          aria-label={homeAudience === "mentor" ? "Mentor focus" : "Student focus"}
        >
          <header className="dash-role-strip-head">
            <span>{homeAudience === "mentor" ? "Mentor focus" : "Student focus"}</span>
            <a href={withOrgHref("/logistics", orgId)}>
              {homeAudience === "mentor" ? "Hotels & travel" : "My hotel & leave times"}
            </a>
          </header>
          <ul>
            {homeStripItems.map((item) => (
              <li key={item.key} data-tone={item.tone}>
                <a href={item.href}>
                  <span>{item.label}</span>
                  <strong>
                    {item.at ? (
                      <>
                        {item.detail}
                        <em className="dash-strip-countdown">
                          {" · "}
                          <LiveCountdown iso={item.at} />
                        </em>
                      </>
                    ) : (
                      item.detail
                    )}
                  </strong>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {message ? (
        <p className={`telemetry-status${messageKind === "success" ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {orgId && meLoaded && !editing ? (
        <DashboardBoardBar
          boards={switcherBoards}
          activeId={board?.id}
          saving={saving}
          editing={editing}
          managing={boardsOpen}
          onSwitch={(id) => void switchBoard(id)}
          onCreatePersonal={() => void createBoard("personal")}
          onManage={() => {
            setBoardsOpen(true);
            setRenameId(null);
          }}
        />
      ) : null}

      {dashShell !== "ready" ? (
        <DashboardSetupBanner shell={dashShell} nextActions={nextActions} setupSteps={setupSteps} />
      ) : null}

      {meLoaded && dashShell === "ready" && nextActions.length > 0 && !editing ? (
        <p className="dash-ready-cue" role="status">
          <span>
            <strong>{nextActions[0]?.label}</strong>
            {nextActions[0]?.detail ? ` — ${nextActions[0].detail}` : ""}
          </span>
          {nextActions[0]?.href ? (
            <Button as="a" variant="secondary" href={nextActions[0].href}>
              {nextActions[0].label}
            </Button>
          ) : null}
        </p>
      ) : null}

      <OfflineBanner feature="Home" fromCache={fromCache} cachedAt={cachedAt} />

      {meLoaded && orgId && tbaConfigured !== false ? (
        <DataSourceDegradedBanner health={dataSourceHealth} />
      ) : null}

      {editing ? (
        <DashboardWidgetPalette
          cols={cols}
          gridLabel={grid.label}
          layoutCount={layout.length}
          addableCount={addableEntries.length}
          paletteEntries={paletteEntries}
          draggingType={drag?.kind === "add" ? drag.type : null}
          saving={saving}
          libraryOpen={libraryOpen}
          orgId={orgId}
          canShareOrg={canShareOrg}
          onTidy={tidyLayout}
          onToggleLibrary={() => setLibraryOpen((open) => !open)}
          onSave={() => void save("personal")}
          onBeginPaletteDrag={beginPaletteDrag}
          onDragPointerMove={onDragPointerMove}
          onDragPointerUp={onDragPointerUp}
          onDragPointerCancel={onDragPointerCancel}
          onPaletteClick={(entry, event) => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            requestPlaceWidget(
              entry,
              prefersTapToPlace({
                pointerType: "pointerType" in event.nativeEvent ? String(event.nativeEvent.pointerType) : "",
                coarse: window.matchMedia("(pointer: coarse)").matches,
              }),
            );
          }}
        />
      ) : null}

      {dashShell === "ready" || editing ? (
        <section
          className={`dash-grid-wrap${editing ? " editing" : ""}${dragging ? " dragging" : ""}${
            drag?.kind === "add" ? " receiving-widget" : ""
          }`}
          aria-label="Dashboard widgets"
          data-testid="dash-widget-grid"
          data-dash-drag={editing ? "on" : "off"}
        >
          {editing ? (
            <div className="dash-grid-guide">
              <span>
                {cols === 1 ? "Single column" : `${cols}-column snap`} · {grid.label}
              </span>
              <small>
                {pendingPlaceType
                  ? `Tap a slot to place ${catalogEntry(pendingPlaceType)?.label ?? pendingPlaceType}`
                  : "Hold to drag · S/M/L/XL resize · space + arrows from the keyboard"}
              </small>
            </div>
          ) : null}
          {snapFeedback ? (
            <output className="dash-snap-hud" aria-hidden="true">
              <strong>{snapFeedback.mode}</strong>
              <span>
                {cols === 1
                  ? `position ${snapFeedback.y + 1}`
                  : `columns ${snapFeedback.x + 1}–${snapFeedback.x + snapFeedback.w}`}
              </span>
              <span>row {snapFeedback.y + 1}</span>
              <b>
                {snapFeedback.w} × {snapFeedback.h}
              </b>
            </output>
          ) : null}

          {mounted && boardIsEmpty && editing ? (
            <button
              type="button"
              className="dash-empty-board"
              data-testid="dash-empty-board"
              onClick={() => {
                if (pendingPlaceType) {
                  addWidget(pendingPlaceType);
                  return;
                }
                setLibraryOpen(true);
              }}
            >
              <span className="dash-empty-board-plus" aria-hidden="true">
                +
              </span>
              <strong>Add your first widget</strong>
              <span>
                Pick next match, robot readiness, scouting coverage and more — then drag them into the order
                your team reads them.
              </span>
            </button>
          ) : mounted && viewLayout.length === 0 && !editing ? (
            <div className="dash-quiet-home" role="status">
              <strong>Nothing live yet</strong>
              <span>
                Home stays quiet until match, scouting, or robot data exists. Edit Home to pin widgets anyway.
              </span>
            </div>
          ) : (
            <div
              ref={setCanvasNode}
              className="dash-grid dash-pgrid"
              data-editing={editing ? "true" : "false"}
              data-pending-place={pendingPlaceType ?? ""}
              data-testid="dash-place-canvas"
              data-measured={measured && width > 0 ? "true" : "false"}
              onClick={(event) => {
                if (editing && pendingPlaceType) placePendingAtPoint(event);
              }}
              style={
                {
                  height: `${Math.max(width > 0 ? gridHeight : 240, grid.rowHeight)}px`,
                  "--dash-cols": cols,
                  "--dash-row-h": `${grid.rowHeight}px`,
                  "--dash-gap": `${gap}px`,
                } as CSSProperties
              }
            >
              {width <= 0 ? <div className="dash-grid-skeleton" aria-hidden="true" /> : null}
              {width > 0 && dropBox ? (
                <div
                  className="dash-drop-slot"
                  aria-hidden="true"
                  style={{
                    transform: `translate3d(${dropBox.left}px, ${dropBox.top}px, 0)`,
                    width: `${dropBox.width}px`,
                    height: `${dropBox.height}px`,
                  }}
                >
                  <span>{drag?.label}</span>
                </div>
              ) : null}

              {width > 0
                ? displayLayout.map((item) => {
                    const box = cellBox(item, canvasWidth, cols, grid.rowHeight, gap);
                    const label = catalogEntry(item.type)?.label ?? item.type;
                    const saved = layout.find((row) => row.i === item.i) ?? item;
                    const entry = catalogEntry(item.type);
                    return (
                      <DashboardGridItem
                        key={item.i}
                        item={item}
                        box={box}
                        label={label}
                        editing={editing}
                        isDragging={drag?.kind === "move" && drag.id === item.i}
                        isGrabbed={grabbedId === item.i}
                        currentSize={inferWidgetSize(saved)}
                        atDefault={!entry || (saved.w === entry.defaultW && saved.h === entry.defaultH)}
                        payload={widgets[item.type]}
                        orgId={orgId}
                        tbaConfigured={tbaConfigured}
                        onCardPointerDown={(event, target) => {
                          if (!editing) return;
                          const node = event.target as HTMLElement;
                          if (node.closest("button, a, input, select, textarea")) return;
                          beginCardDrag(event, target, "longpress");
                        }}
                        onHandlePointerDown={(event, target) => {
                          event.stopPropagation();
                          beginCardDrag(event, target, "immediate");
                        }}
                        onDragPointerMove={onDragPointerMove}
                        onDragPointerUp={onDragPointerUp}
                        onDragPointerCancel={onDragPointerCancel}
                        onHandleKeyDown={onHandleKeyDown}
                        onRemove={removeWidget}
                        onResize={setWidgetSize}
                        onResetSize={resetWidgetSize}
                      />
                    );
                  })
                : null}
            </div>
          )}
        </section>
      ) : null}

      {drag ? (
        <div
          ref={proxyRef}
          className="dash-drag-proxy"
          aria-hidden="true"
          style={{ width: `${drag.size.width}px`, height: `${Math.min(drag.size.height, 220)}px` }}
        >
          <i>
            <Icon name={WIDGET_PICKER_ICON[drag.type] ?? "grid"} />
          </i>
          <strong>{drag.label}</strong>
          <span>
            {cols === 1
              ? `Position ${drag.cell.row + 1}`
              : `Row ${drag.cell.row + 1} · Column ${drag.cell.col + 1}`}
          </span>
          <small>{drag.kind === "add" ? "Release to place" : "Release to drop"}</small>
        </div>
      ) : null}

      {editing ? (
        <DashboardEditDock
          saving={saving}
          libraryOpen={libraryOpen}
          canShareOrg={canShareOrg}
          onCancel={cancelEditing}
          onReset={() => void resetDefault()}
          onTidy={tidyLayout}
          onToggleLibrary={() => setLibraryOpen((open) => !open)}
          onPreview={() => {
            setEditing(false);
            setPreviewing(true);
            setLibraryOpen(false);
          }}
          onSavePersonal={() => void save("personal")}
          onSaveOrg={() => void save("org")}
        />
      ) : null}

      {previewing ? (
        <DashboardPreviewDock
          saving={saving}
          onBack={enterEditMode}
          onSave={() => void save("personal")}
        />
      ) : null}

      {!editing && !previewing && orgId ? <PartnerPlacement orgId={orgId} surface="dashboard_footer" title="Partners powering this season" /> : null}

      {editing && libraryOpen ? (
        <DashboardWidgetLibrary
          open
          onClose={() => setLibraryOpen(false)}
          addableEntries={addableEntries}
          paletteEntries={paletteEntries}
          onPick={(entry) => {
            requestPlaceWidget(
              entry,
              prefersTapToPlace({
                coarse: window.matchMedia("(pointer: coarse)").matches,
              }),
              true,
            );
          }}
        />
      ) : null}

      {boardsOpen ? (
        <DashboardBoardsModal
          open
          onClose={() => {
            setBoardsOpen(false);
            setRenameId(null);
          }}
          board={board}
          personalBoards={personalBoards}
          orgBoards={orgBoards}
          saving={saving}
          editing={editing}
          canShareOrg={canShareOrg}
          renameId={renameId}
          renameDraft={renameDraft}
          onRenameDraft={setRenameDraft}
          onSwitch={(id) => void switchBoard(id)}
          onRename={(id, name) => void renameBoard(id, name)}
          onDuplicate={(id) => void duplicateBoard(id)}
          onDelete={(id) => void deleteBoard(id)}
          onStartRename={(id, name) => {
            setRenameId(id);
            setRenameDraft(name);
          }}
          onCancelRename={() => setRenameId(null)}
          onCreatePersonal={() => void createBoard("personal")}
          onCreateOrg={() => void createBoard("org")}
        />
      ) : null}
    </main>
  );
}
