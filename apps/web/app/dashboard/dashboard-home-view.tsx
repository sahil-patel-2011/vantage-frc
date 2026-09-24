"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import dynamic from "next/dynamic";
import { orgNameAddsDetail } from "../../components/app-shell-model";
import {
  catalogEntry,
  emptyHomeWidgets,
  inferWidgetSize,
  type DashboardWidgetLayout,
  type WidgetCatalogEntry,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import { cellBox } from "../../lib/dashboard/grid-drag";
import { HIDDEN_ON_HOME_COPY, type HiddenOnHomeReason } from "../../lib/dashboard/edit-mode";
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
import { Button, ConfirmDialog } from "../../components/ui";
import type {
  BoardMeta,
  BoardState,
  DragView,
  Me,
  PaletteRow,
  SnapFeedback,
} from "./dashboard-board-types";
import { DashboardBoardSwitcher } from "./dashboard-board-bar";
import { DashboardSetupBanner } from "./dashboard-setup-banner";
import { CopyShareLink } from "../../components/copy-share-link";
import { VenueShortcutCheatsheet, type VenueShortcut } from "../../hooks/use-venue-shortcuts";
import { homeHeaderDetail, homeNowFromWidgets } from "./dashboard-home-model";
import { FirstWeekCard } from "./first-week-card";
import { DashboardEditToast } from "./dashboard-edit-toast";
import { DashboardHiddenRow } from "./dashboard-hidden-row";
import "./dashboard-edit.css";

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
const PartnerPlacement = dynamic(() => import("../../components/partner-placement"), {
  ssr: false,
});

type GridSpec = {
  label: string;
  cols: number;
  rowHeight: number;
};

/** "a, b and c" */
function listWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** Height of the fixed top bar; the board is brought in just under it. */
const TOPBAR_PX = 56;

export function DashboardHomeView(props: {
  me: Me;
  meLoaded: boolean;
  orgId: string;
  board: BoardState | null;
  switcherBoards: BoardMeta[];
  personalBoards: BoardMeta[];
  orgBoards: BoardMeta[];
  layout: DashboardWidgetLayout[];
  viewLayout: DashboardWidgetLayout[];
  displayLayout: DashboardWidgetLayout[];
  widgets: Record<string, WidgetPayload>;
  widgetsLoaded?: boolean;
  paletteEntries: PaletteRow[];
  hiddenOnHome: Map<string, HiddenOnHomeReason>;
  homeStripItems: HomeStripItem[];
  homeAudience: "mentor" | "student" | null;
  nextMatchData: Record<string, unknown> | undefined;
  dashShell: DashboardShellKind;
  nextActions: DashboardNextAction[];
  setupSteps: DashboardSetupStep[];
  /** The owner's "Set up your team" card is on screen; other setup prompts step aside. */
  teamSetupCard?: boolean;
  onTeamSetupChange?: (showing: boolean) => void;
  dataSourceHealth: DataSourceHealthView | null;
  canOpenTeamData?: boolean;
  tbaConfigured: boolean | undefined;
  setupRequired: boolean;
  eventName: unknown;
  editing: boolean;
  previewing: boolean;
  libraryOpen: boolean;
  saving: boolean;
  canShareOrg: boolean;
  canUndo: boolean;
  boardsOpen: boolean;
  renameId: string | null;
  renameDraft: string;
  grabbedId: string | null;
  highlightId: string | null;
  message: string;
  messageKind: "success" | "error";
  messageAction: "undo" | null;
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
  setHighlightId: (id: string | null) => void;
  dismissMessage: () => void;
  enterEditMode: () => void;
  cancelEditing: () => void;
  hasUnsavedChanges: () => boolean;
  undo: () => void;
  tidyLayout: () => void;
  save: (scope?: "personal" | "org") => Promise<void> | void;
  resetDefault: () => Promise<void> | void;
  switchBoard: (id: string, opts?: { leaveEditing?: boolean }) => Promise<void> | void;
  createBoard: (scope: "personal" | "org", name?: string) => Promise<void> | void;
  duplicateBoard: (id: string) => Promise<void> | void;
  renameBoard: (id: string, name: string) => Promise<void> | void;
  deleteBoard: (id: string) => Promise<void> | void;
  addWidget: (type: DashboardWidgetLayout["type"]) => void;
  setAlwaysShown: (id: string, always: boolean) => void;
  shareWithTeam: () => Promise<{ id: string; name: string } | null>;
  removeWidget: (id: string) => void;
  setWidgetSize: (id: string, size: WidgetSizeKey) => void;
  resetWidgetSize: (id: string) => void;
  onHandleKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, item: DashboardWidgetLayout) => void;
  beginCardDrag: (
    event: ReactPointerEvent<HTMLElement>,
    item: DashboardWidgetLayout,
    activation: "immediate" | "longpress" | "intent",
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
    switcherBoards,
    personalBoards,
    orgBoards,
    layout,
    viewLayout,
    displayLayout,
    widgets,
    widgetsLoaded,
    paletteEntries,
    hiddenOnHome,
    homeStripItems,
    homeAudience,
    nextMatchData,
    dashShell,
    nextActions,
    setupSteps,
    dataSourceHealth,
    canOpenTeamData = false,
    tbaConfigured,
    setupRequired,
    eventName,
    editing,
    previewing,
    libraryOpen,
    saving,
    canShareOrg,
    canUndo,
    boardsOpen,
    renameId,
    renameDraft,
    grabbedId,
    highlightId,
    message,
    messageKind,
    messageAction,
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
    setHighlightId,
    dismissMessage,
    enterEditMode,
    cancelEditing,
    hasUnsavedChanges,
    undo,
    tidyLayout,
    save,
    resetDefault,
    switchBoard,
    createBoard,
    duplicateBoard,
    renameBoard,
    deleteBoard,
    addWidget,
    setAlwaysShown,
    shareWithTeam,
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<"discard" | "reset" | "team" | null>(null);
  /** The team board just shared, while the toast about it is up, so it can offer to open it. */
  const [sharedBoard, setSharedBoard] = useState<{ id: string; name: string; message: string } | null>(null);
  const [boardsCreate, setBoardsCreate] = useState<"personal" | null>(null);
  const moreRef = useRef<HTMLDetailsElement | null>(null);
  const gridWrapRef = useRef<HTMLElement | null>(null);
  /** Where the board sat on screen just before edit mode, so it can stay there. */
  const anchorTopRef = useRef<number | null>(null);

  /*
    Things above the board stay on the page while you edit, dimmed and inert,
    instead of being swapped out. Swapping them out (and dropping a palette in)
    is what moved the board two screens down the moment you tapped Edit.
  */
  const dim = editing ? ({ inert: true, "data-edit-dim": "true" } as const) : {};

  const boardTop = () => {
    const first = gridWrapRef.current?.querySelector<HTMLElement>("[data-testid='dash-grid-item']") ?? gridWrapRef.current;
    return first ? first.getBoundingClientRect().top : null;
  };

  const startEditing = () => {
    anchorTopRef.current = boardTop();
    moreRef.current?.removeAttribute("open");
    enterEditMode();
  };

  // Keep the first card where it was on screen; on a phone (or when the board
  // starts below the fold) bring it up under the top bar instead.
  useLayoutEffect(() => {
    // FirstWeekCard renders its own root, so it is dimmed from here.
    document.querySelectorAll<HTMLElement>(".dash-home > .dash-first-week").forEach((node) => {
      node.toggleAttribute("inert", editing);
      if (editing) node.dataset.editDim = "true";
      else delete node.dataset.editDim;
    });
    if (!editing) {
      setSelectedId(null);
      return;
    }
    const before = anchorTopRef.current;
    anchorTopRef.current = null;
    const after = boardTop();
    if (before !== null && after !== null && Math.abs(after - before) > 1) window.scrollBy(0, after - before);
    const settled = boardTop();
    if (settled === null) return;
    if (window.innerWidth < 720 || settled > window.innerHeight - 200 || settled < TOPBAR_PX) {
      gridWrapRef.current?.scrollIntoView({ block: "start" });
    }
    // Measured only on the way in; the board is laid out by then.
  }, [editing]);

  // A new card scrolls into view and flashes once.
  useEffect(() => {
    if (!highlightId || width <= 0) return;
    const node = document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(highlightId)}"]`);
    if (node) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      node.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    }
    const timer = window.setTimeout(() => setHighlightId(null), 1800);
    return () => window.clearTimeout(timer);
  }, [highlightId, width, setHighlightId]);

  // "More" is a <details>: it stays open until something closes it, so
  // clicking outside it or pressing Escape does.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const details = moreRef.current;
      if (details?.open && !details.contains(event.target as Node)) details.removeAttribute("open");
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const requestCancel = useCallback(() => {
    if (hasUnsavedChanges()) setConfirmKind("discard");
    else cancelEditing();
  }, [hasUnsavedChanges, cancelEditing]);

  // Escape is Cancel (asking first if there is anything to lose), and
  // Ctrl/Cmd+Z steps back one change. Anything that handles Escape itself —
  // a drag, a picked-up card, the widget sheet, the ••• menu — goes first.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || confirmKind || boardsOpen) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      if ((event.key === "z" || event.key === "Z") && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        if (typing) return;
        event.preventDefault();
        undo();
        return;
      }
      if (event.key !== "Escape" || dragging || grabbedId) return;
      event.preventDefault();
      if (libraryOpen) {
        setLibraryOpen(false);
        return;
      }
      requestCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, confirmKind, boardsOpen, dragging, grabbedId, libraryOpen, setLibraryOpen, undo, requestCancel]);

  const closeLibrary = useCallback(() => setLibraryOpen(false), [setLibraryOpen]);
  // Cards Home is leaving out right now, listed under the board while editing.
  const hiddenRows = editing
    ? layout.filter((item) => hiddenOnHome.has(item.i) && !displayLayout.some((shown) => shown.i === item.i))
    : [];
  const openBoards = (create: "personal" | null) => {
    setBoardsCreate(create);
    setBoardsOpen(true);
    setRenameId(null);
  };
  const emptyLabels = orgId && !editing ? emptyHomeWidgets(layout, widgets) : [];
  // "Nothing you have to do right now" sat above a four-step setup list for a new owner.
  // While that list shows, the quiet state says what is actually next. The mentor strip
  // (duties, rooms, checklists) steps aside too: "all clear" on a team with no data is noise.
  const nowView =
    props.teamSetupCard && now.quiet
      ? {
          ...now,
          title: "Finish setting up your team",
          detail: "The steps below get everyone else going. Matches, duties and tasks show up here once there are some.",
        }
      : now;
  // Errors outside edit mode stay at the top, where the thing that failed is.
  // Everything else is a toast by the toolbar.
  const inlineError = !editing && !previewing && messageKind === "error" && message;

  return (
    <main className={`dash-home scan-workbench scan-hub--dashboard${editing ? " is-editing" : ""}`} data-grid={grid.label} data-cols={cols}>
      <p className="dash-live-region" role="status" aria-live="polite">
        {announce}
      </p>

      <header className="dash-home-header">
        <div {...dim}>
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
            {/* The hour is the browser clock; the server renders in UTC. */}
            {knownName ? `${mounted ? greeting() : "Welcome"}, ${knownName}` : mounted ? greeting() : "Welcome"}
          </h1>
          {orgId && meLoaded ? (
            <DashboardBoardSwitcher
              boards={switcherBoards}
              board={board}
              saving={saving}
              disabled={editing || previewing}
              onSwitch={(id) => void switchBoard(id)}
              onNew={() => openBoards("personal")}
              onManage={() => openBoards(null)}
            />
          ) : null}
          {me.teamNumber && orgNameAddsDetail(me.teamNumber, me.orgName) ? (
            <p className="dash-hero-org">{me.orgName}</p>
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
        {!editing && !previewing ? (
          <div className="dash-home-actions">
            {nextMatchData && !viewLayout.some((item) => item.type === "next_match") ? (
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
            {/* A quiet "Edit" beside the greeting, the way iOS does it. It
                spent a while folded inside "More" as plain text among buttons,
                where testers could not find it at all. It is still quiet —
                arranging Home is occasional — but it is where you look. */}
            <button
              type="button"
              className="dash-edit-button"
              data-testid="dash-customize"
              data-tour="customise"
              aria-label="Edit Home — rearrange, add, or remove widgets"
              onClick={startEditing}
            >
              Edit
            </button>
            <details className="dash-home-more" ref={moreRef}>
              <summary aria-label="More home tools">More</summary>
              <div
                onClick={(event) => {
                  const item = (event.target as HTMLElement).closest("button, a");
                  if (!item) return;
                  // Copy link says "Link copied" in place, so it gets a moment
                  // to be read; everything else closes the menu at once.
                  const delay = item.closest("[data-more-delay]") ? 1200 : 0;
                  window.setTimeout(() => moreRef.current?.removeAttribute("open"), delay);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  moreRef.current?.removeAttribute("open");
                  moreRef.current?.querySelector("summary")?.focus();
                }}
              >
                <span data-more-delay="">
                  <CopyShareLink orgId={orgId || null} />
                </span>
                {updatedAt && orgId && !fromCache ? (
                  <small className="dash-updated">Synced · {new Date(updatedAt).toLocaleTimeString()}</small>
                ) : null}
              </div>
            </details>
          </div>
        ) : null}
      </header>
      <section className="dash-now" aria-label="What to do now" data-testid="dash-now" {...dim}>
        {/* This card used to carry an eyebrow reading "What to do now", a
            heading, a sentence, and a button — four ways of saying one
            thing, stacked. The heading says it, the button does it, and the
            section keeps its aria-label so nothing is lost to a screen
            reader. The sentence stays only when it adds a fact the other
            two do not. */}
        <div>
          <strong>{nowView.title}</strong>
          {nowView.detail ? <p>{nowView.detail}</p> : null}
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
      {/* Left unwrapped (product-motion.css animates it as a direct child);
          the edit-mode effect above makes it inert instead. */}
      {orgId ? <FirstWeekCard orgId={orgId} onTeamSetupChange={props.onTeamSetupChange} /> : null}
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      {orgId && homeStripItems.length > 0 && !props.teamSetupCard ? (
        <section
          className="dash-role-strip"
          data-audience={homeAudience ?? "student"}
          aria-label={homeAudience === "mentor" ? "Mentor focus" : "This week"}
          {...dim}
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

      {inlineError ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {dashShell !== "ready" && !props.teamSetupCard ? (
        <DashboardSetupBanner shell={dashShell} nextActions={nextActions} setupSteps={setupSteps} />
      ) : null}

      {meLoaded && dashShell === "ready" && nextActions.length > 0 && !props.teamSetupCard ? (
        <p className="dash-ready-cue" role="status" {...dim}>
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
        <DataSourceDegradedBanner health={dataSourceHealth} canOpenTeamData={canOpenTeamData} />
      ) : null}

      {emptyLabels.length ? (
        <p className="dash-empty-summary" role="status">
          Nothing yet in {listWords(emptyLabels)}. Those cards come back as soon as they have something.
        </p>
      ) : null}

      {orgId || editing ? (
        <section
          ref={gridWrapRef}
          className={`dash-grid-wrap${editing ? " editing" : ""}${dragging ? " dragging" : ""}${
            drag?.kind === "add" ? " receiving-widget" : ""
          }`}
          aria-label="Home widgets"
          data-testid="dash-widget-grid"
          data-dash-drag={editing ? "on" : "off"}
        >
          {editing ? (
            <p className="dash-edit-hint" data-testid="dash-edit-hint">
              Drag cards to move them. Tap a card to change its size, or − to remove it.
            </p>
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
            </output>
          ) : null}

          {mounted && boardIsEmpty && editing ? (
            <button
              type="button"
              className="dash-empty-board"
              data-testid="dash-empty-board"
              onClick={() => setLibraryOpen(true)}
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
              <span>Tap Edit to add the cards you want to see.</span>
            </div>
          ) : (
            <div
              ref={setCanvasNode}
              className="dash-grid dash-pgrid"
              data-editing={editing ? "true" : "false"}
              data-testid="dash-place-canvas"
              data-measured={measured && width > 0 ? "true" : "false"}
              onClick={(event) => {
                if (!editing) return;
                if (!(event.target as HTMLElement).closest(".dash-grid-item")) setSelectedId(null);
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
                    const hiddenReason = editing ? hiddenOnHome.get(item.i) : undefined;
                    return (
                      <DashboardGridItem
                        key={item.i}
                        item={item}
                        box={box}
                        label={label}
                        editing={editing}
                        isDragging={drag?.kind === "move" && drag.id === item.i}
                        isGrabbed={grabbedId === item.i}
                        selected={editing && selectedId === item.i}
                        isNew={highlightId === item.i}
                        hiddenNote={hiddenReason ? HIDDEN_ON_HOME_COPY[hiddenReason] : null}
                        currentSize={inferWidgetSize(saved)}
                        atDefault={!entry || (saved.w === entry.defaultW && saved.h === entry.defaultH)}
                        payload={widgets[item.type]}
                        orgId={orgId}
                        tbaConfigured={tbaConfigured}
                        canOpenTeamData={canOpenTeamData}
                        onSelect={setSelectedId}
                        onCardPointerDown={(event, target) => {
                          if (!editing) return;
                          const node = event.target as HTMLElement;
                          if (node.closest("button, a, input, select, textarea")) return;
                          // A mouse drags as soon as it moves; a finger has to
                          // hold first, so a swipe still scrolls the page.
                          beginCardDrag(event, target, event.pointerType === "mouse" ? "intent" : "longpress");
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
          <DashboardHiddenRow
            rows={hiddenRows}
            reasons={hiddenOnHome}
            onAlwaysShow={(id) => setAlwaysShown(id, true)}
            onRemove={removeWidget}
          />
        </section>
      ) : null}

      {drag?.kind === "move" ? (
        <div
          key="move-proxy"
          ref={proxyRef}
          className="dash-drag-proxy is-card"
          aria-hidden="true"
          style={{ width: `${drag.size.width}px`, height: `${drag.size.height}px` }}
        >
          {/* Filled with a copy of the card by the drag hook; React leaves it empty. */}
          <div className="dash-drag-proxy-copy" data-proxy-copy="" />
        </div>
      ) : drag ? (
        <div
          key="add-proxy"
          ref={proxyRef}
          className="dash-drag-proxy"
          aria-hidden="true"
          style={{ width: `${drag.size.width}px`, height: `${Math.min(drag.size.height, 220)}px` }}
        >
          <i>
            <Icon name={WIDGET_PICKER_ICON[drag.type] ?? "grid"} />
          </i>
          <strong>{drag.label}</strong>
          <small>Release to place</small>
        </div>
      ) : null}

      {editing ? (
        <DashboardEditDock
          saving={saving}
          libraryOpen={libraryOpen}
          canShareOrg={canShareOrg}
          canUndo={canUndo}
          onCancel={requestCancel}
          onUndo={undo}
          onToggleLibrary={() => setLibraryOpen((open) => !open)}
          onTidy={tidyLayout}
          onPreview={() => {
            setEditing(false);
            setPreviewing(true);
            setLibraryOpen(false);
          }}
          onReset={() => setConfirmKind("reset")}
          onSaveOrg={() => setConfirmKind("team")}
          onDone={() => void save("personal")}
        />
      ) : null}

      {previewing ? (
        <DashboardPreviewDock
          saving={saving}
          onBack={enterEditMode}
          onSave={() => void save("personal")}
        />
      ) : null}

      <DashboardEditToast
        message={inlineError ? "" : message}
        kind={messageKind}
        action={editing ? messageAction : null}
        editing={editing || previewing}
        onUndo={undo}
        secondary={
          sharedBoard && sharedBoard.message === message && editing
            ? {
                label: "Open team board",
                testId: "dash-toast-open-board",
                onClick: () => {
                  const target = sharedBoard;
                  setSharedBoard(null);
                  void switchBoard(target.id, { leaveEditing: true });
                },
              }
            : null
        }
        onDismiss={dismissMessage}
      />

      {!editing && !previewing && orgId ? <PartnerPlacement orgId={orgId} surface="dashboard_footer" title="Partners powering this season" /> : null}

      {editing ? (
        <DashboardWidgetLibrary
          open={libraryOpen}
          onClose={closeLibrary}
          rows={paletteEntries}
          dragOut={drag?.kind === "add"}
          onBeginDrag={beginPaletteDrag}
          onDragPointerMove={onDragPointerMove}
          onDragPointerUp={onDragPointerUp}
          onDragPointerCancel={onDragPointerCancel}
          onPick={(entry) => {
            // A drag out of the sheet ends in a click on the same button.
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            // Same on every screen: the card goes on the board at once, the
            // sheet closes, and the board scrolls to it and flashes it. Phones
            // used to switch to "tap a slot on the board", with no slots
            // shown and no way to tell a slot from empty space.
            addWidget(entry.type);
          }}
        />
      ) : null}

      <ConfirmDialog
        open={confirmKind !== null}
        opts={
          confirmKind === "reset"
            ? {
                title: "Reset this board?",
                body: "Your cards go back to the standard set for your role. Nothing is saved until you tap Done, and Undo brings your layout back.",
                confirmLabel: "Reset board",
                cancelLabel: "Keep my layout",
              }
            : confirmKind === "team"
              ? board?.scope === "org" && board.id
                ? {
                    title: `Update ${board.name} for the team?`,
                    body: "Everyone who uses this team board will see this layout.",
                    confirmLabel: "Save for team",
                    cancelLabel: "Keep editing",
                  }
                : {
                    title: "Share this layout as a team board?",
                    body: "Everyone on the team can switch to it from their boards. Your own Home stays as it is, and you stay on it.",
                    confirmLabel: "Share with team",
                    cancelLabel: "Keep editing",
                  }
            : confirmKind === "discard"
              ? {
                  title: "Discard changes?",
                  body: "The changes you made to this board since tapping Edit will be lost.",
                  confirmLabel: "Discard changes",
                  cancelLabel: "Keep editing",
                }
              : null
        }
        onResolve={(ok) => {
          const kind = confirmKind;
          setConfirmKind(null);
          if (!ok) return;
          if (kind === "reset") void resetDefault();
          if (kind === "discard") cancelEditing();
          if (kind === "team") {
            const onTeamBoard = board?.scope === "org" && Boolean(board.id);
            void shareWithTeam().then((shared) => {
              if (!shared || onTeamBoard) return;
              setSharedBoard({ ...shared, message: `Shared as “${shared.name}”. You're still on your own board.` });
            });
          }
        }}
      />

      {boardsOpen ? (
        <DashboardBoardsModal
          open
          onClose={() => {
            setBoardsOpen(false);
            setBoardsCreate(null);
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
          initialCreate={boardsCreate}
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
          onCreatePersonal={(name) => void createBoard("personal", name)}
          onCreateOrg={(name) => void createBoard("org", name)}
        />
      ) : null}
    </main>
  );
}
