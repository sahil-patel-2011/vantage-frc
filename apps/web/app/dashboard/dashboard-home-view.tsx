"use client";

import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  Ref,
} from "react";
import dynamic from "next/dynamic";
import { orgNameAddsDetail } from "../../components/app-shell-model";
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
import { withOrgHref } from "../../lib/nav/product-nav";
import { Icon } from "../../components/icon";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../components/offline-banner";
import type { DataSourceHealthView } from "../../lib/reference-health";
import { DashboardGridItem } from "./dashboard-grid-item";
import { LiveCountdown } from "./widgets";
import { WIDGET_PICKER_ICON, greeting } from "./dashboard-canvas";
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
import { homeHeaderDetail, homeNowFromWidgets } from "./dashboard-home-model";
import { FirstWeekCard } from "./first-week-card";

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
  widgetsLoaded?: boolean;
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
    widgetsLoaded,
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

  const knownName = meLoaded ? (me.firstName || me.name || "").trim().split(/\s+/)[0] : "";
  const boardIsEmpty = layout.length === 0;
  const now = homeNowFromWidgets({ orgId, nextMatchData, widgets, loaded: widgetsLoaded });

  return (
    <main className={`dash-home scan-workbench scan-hub--dashboard${editing ? " is-editing" : ""}`} data-grid={grid.label} data-cols={cols}>
      <p className="dash-live-region" role="status" aria-live="polite">
        {announce}
      </p>

      <header className="dash-home-header">
        <div>
          {/* The team number is the thing you are looking at; the greeting is
              a courtesy above it. It used to be the other way round — the
              number sat in small grey breadcrumb text while "Good morning"
              took the headline, which is the wrong way up for a page you open
              at an event. */}
          {/* The team number is not repeated here.
              It is in the top bar on every page, including this one, and it
              was the largest thing on the screen — "Team 6925" two rows above
              a 56px "6925", telling you a fact you had just read and that
              never changes while you are signed in. The greeting is what is
              actually specific to opening the page, so it takes the line, and
              the team name appears only when it says more than the number. */}
          <h1 className="dash-hero-greeting">
            {knownName ? `${greeting()}, ${knownName}` : greeting()}
          </h1>
          {board && !board.isDefault ? (
            <span className="dash-scope-pill" data-scope={scope}>
              {scope === "org" ? "Team board" : "Personal board"}
            </span>
          ) : null}
          {me.teamNumber && orgNameAddsDetail(me.teamNumber, me.orgName) ? (
            <p className="dash-hero-org">{me.orgName}</p>
          ) : null}
          {orgId && board && !board.isDefault && switcherBoards.length > 1 ? (
            <p className="dash-board-current">
              <strong>{board.name}</strong>
            </p>
          ) : null}
          {(() => {
            const detail = homeHeaderDetail({
              meLoaded,
              orgId,
              tbaConfigured,
              setupRequired,
              eventName,
            });
            return detail ? <p>{detail}</p> : null;
          })()}
          {/* The event you are at, as its own row you can tap — it is the
              single most looked-up fact on this page during a competition.
              Absent until an event is actually set; there is no placeholder. */}
          {typeof eventName === "string" && eventName.trim() ? (
            <a className="dash-hero-event" data-tour="event" href={withOrgHref("/command", orgId || null)}>
              <Icon name="pin" />
              <span>{eventName}</span>
              <Icon name="chevron" />
            </a>
          ) : null}
        </div>
        <div className="dash-home-actions">
          {nextMatchData && !editing && !viewLayout.some((item) => item.type === "next_match") ? (
            <a className="dash-next-glance" href={withOrgHref("/my-day", orgId || null)}>
              <span>Next</span>
              <strong>
                {String(nextMatchData.compLevel ?? "Match").toUpperCase()} {String(nextMatchData.matchNumber ?? "")}
              </strong>
              <b>
                <LiveCountdown iso={nextMatchData.scheduledTime as string | undefined} />
              </b>
            </a>
          ) : null}
          <details className="dash-home-more">
            <summary aria-label="More home tools">More</summary>
            <div>
              {/* Edit Home lives in here rather than beside the greeting.
                  Arranging widgets is something you do once and then leave
                  alone for a season, and it was one of only two controls on
                  the page — so the quietest screen in the app opened with a
                  button most people will never press again. */}
              {!editing && !previewing ? (
                <button
                  type="button"
                  className="dash-edit-trigger"
                  data-testid="dash-customize"
                  data-tour="customise"
                  aria-label="Edit Home — rearrange, add, or remove widgets"
                  onClick={enterEditMode}
                >
                  Edit Home
                </button>
              ) : null}
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
      {!editing ? (
        <section className="dash-now" aria-label="What to do now" data-testid="dash-now">
          {/* This card used to carry an eyebrow reading "What to do now", a
              heading, a sentence, and a button — four ways of saying one
              thing, stacked. The heading says it, the button does it, and the
              section keeps its aria-label so nothing is lost to a screen
              reader. The sentence stays only when it adds a fact the other
              two do not. */}
          <div>
            <strong>{now.title}</strong>
            {now.detail ? <p>{now.detail}</p> : null}
          </div>
          {now.quiet ? (
            <a className="dash-now-quiet" href={withOrgHref(now.href, orgId || null)}>
              {now.cta} →
            </a>
          ) : (
            <Button as="a" variant="primary" href={withOrgHref(now.href, orgId || null)}>
              {now.cta}
            </Button>
          )}
        </section>
      ) : null}
      {orgId && !editing ? <FirstWeekCard orgId={orgId} /> : null}
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      {orgId && !editing && homeStripItems.length > 0 ? (
        <section
          className="dash-role-strip"
          data-audience={homeAudience ?? "student"}
          aria-label={homeAudience === "mentor" ? "Mentor focus" : "This week"}
        >
          <header className="dash-role-strip-head">
            <span>{homeAudience === "mentor" ? "Mentor focus" : "This week"}</span>
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
          <span>{nextActions[0]?.detail ?? nextActions[0]?.label}</span>
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

      {orgId || editing ? (
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
                Add next match, my day, learn, files, or chat — then drag them into the order
                your team reads them.
              </span>
            </button>
          ) : mounted && viewLayout.length === 0 && !editing ? (
            <div className="dash-quiet-home" role="status">
              <strong>No widgets on this board</strong>
              <span>Use Customize widgets to add the cards you want to see.</span>
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
          onPick={(entry, pointerType) => {
            requestPlaceWidget(
              entry,
              prefersTapToPlace({
                pointerType,
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
