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
import {
  catalogEntry,
  inferWidgetSize,
  isAlwaysShown,
  type DashboardWidgetLayout,
  type WidgetCatalogEntry,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import { cellBox } from "../../lib/dashboard/grid-drag";
import { type HiddenOnHomeReason } from "../../lib/dashboard/edit-mode";
import { readingOrder } from "../../lib/dashboard/board-order";
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
import type { RoleOnboardingView } from "../../lib/role-onboarding/types";
import { DashboardGridItem } from "./dashboard-grid-item";
import { DashboardRoleStrip } from "./dashboard-role-strip";
import { WIDGET_PICKER_ICON, greeting } from "./dashboard-canvas";
import type { HomeStripItem } from "../../lib/home-workflows";
import { Button, EmptyState } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type {
  BoardMeta,
  BoardState,
  DragView,
  Me,
  PaletteRow,
  SnapFeedback,
} from "./dashboard-board-types";
import { DashboardSetupBanner } from "./dashboard-setup-banner";

import { VenueShortcutCheatsheet, type VenueShortcut } from "../../hooks/use-venue-shortcuts";
import { homeHeaderDetail, homeNowFromWidgets, homeSetupSurfaces, showStandaloneSetupBanner } from "./dashboard-home-model";
import { FirstWeekCard, type SetupHero } from "./first-week-card";
import { DashboardEditToast } from "./dashboard-edit-toast";
import type { CustomizeRow } from "./dashboard-customize-sheet";
import { DashboardHomeHeader } from "./dashboard-home-header";
import { DashboardBoardSwitcher } from "./dashboard-board-bar";
import { DashboardHomeSkeleton, DashboardNowCard } from "./dashboard-now-card";
import { DashboardWorkspaceActions } from "./dashboard-workspace-actions";
import { DashboardHomeDialogs, type HomeConfirm } from "./dashboard-home-dialogs";
import { useHydrated } from "../../lib/ui/use-hydrated";
import "./dashboard-edit.css";
import "./dashboard-home.css";

// Edit Home's panel loads when someone opens it, not with Home's first paint.
const DashboardCustomizeSheet = dynamic(
  () => import("./dashboard-customize-sheet").then((mod) => mod.DashboardCustomizeSheet),
  { ssr: false },
);
const DashboardPreviewDock = dynamic(
  () => import("./dashboard-edit-dock").then((mod) => mod.DashboardPreviewDock),
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

/** Height of the fixed top bar; the board is brought in just under it. */
const TOPBAR_PX = 56;

export function DashboardHomeView(props: {
  me: Me;
  meLoaded: boolean;
  /** Session and the real board have both arrived; until then Home is a skeleton. */
  homeReady: boolean;
  orgId: string;
  board: BoardState | null;
  switcherBoards: BoardMeta[];
  personalBoards: BoardMeta[];
  orgBoards: BoardMeta[];
  layout: DashboardWidgetLayout[];
  viewLayout: DashboardWidgetLayout[];
  displayLayout: DashboardWidgetLayout[];
  widgets: Record<string, WidgetPayload>;
  accessStatus: number | null;
  onReloadAccess: () => void;
  /** Widget data and onboarding steps have arrived, so the hero can say what is next. */
  widgetsLoaded?: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  /** Load Home again after it failed; the one Retry on the failure banner (A5-21). */
  onRetryHome?: () => void;
  showQuietWidgets: boolean;
  quietWidgetCount: number;
  onToggleQuietWidgets: () => void;
  hasScoutingSchemas: boolean;
  paletteEntries: PaletteRow[];
  hiddenOnHome: Map<string, HiddenOnHomeReason>;
  homeStripItems: HomeStripItem[];
  homeAudience: "mentor" | "student" | null;
  nextMatchData: Record<string, unknown> | undefined;
  dashShell: DashboardShellKind;
  nextActions: DashboardNextAction[];
  setupSteps: DashboardSetupStep[];
  /** The team's next setup step, while setup is unfinished. */
  setupHero: SetupHero | null;
  firstWeek: {
    view: RoleOnboardingView | null;
    /** False until the member's setup steps have answered (the setup card may replace the strip). */
    loaded?: boolean;
    busy: string | null;
    error?: string;
    retry?: () => void;
    post: (payload: Record<string, unknown>, key: string) => Promise<void>;
  };
  role: string | null;
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
  canRedo: boolean;
  boardsOpen: boolean;
  renameId: string | null;
  renameDraft: string;
  grabbedId: string | null;
  highlightId: string | null;
  message: string;
  messageKind: "success" | "error";
  messageAction: "undo" | null;
  /** Set when the account call failed: Home says so and offers a retry, never "no team". */
  onRetrySession?: (() => void) | null;
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
  redo: () => void;
  tidyLayout: () => void;
  save: (scope?: "personal" | "org") => Promise<void> | void;
  resetDefault: () => Promise<void> | void;
  switchBoard: (id: string, opts?: { leaveEditing?: boolean }) => Promise<void> | void;
  createBoard: (scope: "personal" | "org", name?: string) => Promise<void> | void;
  duplicateBoard: (id: string) => Promise<void> | void;
  renameBoard: (id: string, name: string) => Promise<void> | void;
  deleteBoard: (id: string) => Promise<void> | void;
  addWidget: (type: DashboardWidgetLayout["type"]) => void;
  moveWidget: (id: string, direction: "up" | "down") => void;
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
    homeReady,
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
    setupHero,
    firstWeek,
    role,
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
    onRetrySession,
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
    redo,
    tidyLayout,
    save,
    resetDefault,
    switchBoard,
    createBoard,
    duplicateBoard,
    renameBoard,
    deleteBoard,
    addWidget,
    moveWidget,
    setAlwaysShown,
    shareWithTeam,
    removeWidget,
    setWidgetSize,
    resetWidgetSize,
    onHandleKeyDown,
    onDragPointerMove,
    onDragPointerUp,
    onDragPointerCancel,
  } = props;

  const hydrated = useHydrated();
  const knownName = meLoaded ? (me.firstName || me.name || "").trim().split(/\s+/)[0] : "";
  // The local time of day is unknown on the server ("Welcome"); on a client navigation back to
  // Home it is known on the first render, so there is no "Welcome" frame before it.
  const hello = hydrated ? greeting() : "Welcome";
  const greetingText = knownName ? `${hello}, ${knownName}` : hello;
  const boardIsEmpty = layout.length === 0;
  const now = homeNowFromWidgets({ orgId, nextMatchData, widgets, loaded: widgetsLoaded, role });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<HomeConfirm | null>(null);
  /** The team board just shared, while the toast about it is up, so it can offer to open it. */
  const [sharedBoard, setSharedBoard] = useState<{ id: string; name: string; message: string } | null>(null);
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const gridWrapRef = useRef<HTMLElement | null>(null);
  const customizeRef = useRef<HTMLButtonElement | null>(null);
  const wasEditing = useRef(false);
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
    enterEditMode();
  };

  // Keep the first card where it was on screen; when the board starts below the fold,
  // bring it up under the top bar instead.
  useLayoutEffect(() => {
    // FirstWeekCard renders its own root, so it is dimmed from here.
    document.querySelectorAll<HTMLElement>(".dash-home > .dash-first-week").forEach((node) => {
      node.toggleAttribute("inert", editing);
      if (editing) node.dataset.editDim = "true";
      else delete node.dataset.editDim;
    });
    if (!editing) {
      setSelectedId(null);
      if (wasEditing.current) customizeRef.current?.focus({ preventScroll: true });
      wasEditing.current = false;
      return;
    }
    wasEditing.current = true;
    const before = anchorTopRef.current;
    anchorTopRef.current = null;
    const after = boardTop();
    if (before !== null && after !== null && Math.abs(after - before) > 1) window.scrollBy(0, after - before);
    const settled = boardTop();
    if (settled === null) return;
    // Only when the board is out of view: on a phone this always scrolled, and the greeting,
    // the board picker and the event chip left the screen the moment Edit was tapped.
    if (settled > window.innerHeight - 200 || settled < TOPBAR_PX) {
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

  /*
    A card's size bar opens under its size button. When that is low on the
    screen the floating toolbar covered it (only "S" showed), so the page
    scrolls just enough to bring the whole bar above the toolbar.
  */
  useEffect(() => {
    if (!selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      const bar = document.querySelector<HTMLElement>(`[data-widget-id="${CSS.escape(selectedId)}"] .dash-item-sizes`);
      const dock = document.querySelector<HTMLElement>("[data-testid='dash-edit-toolbar']");
      if (!bar) return;
      const barBox = bar.getBoundingClientRect();
      const limit = (dock?.getBoundingClientRect().top ?? window.innerHeight) - 12;
      if (barBox.bottom > limit) window.scrollBy({ top: barBox.bottom - limit, behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedId]);

  // A tap anywhere that is not a card's size controls closes them.
  useEffect(() => {
    if (!selectedId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".dash-item-sizes, .dash-size-toggle")) return;
      setSelectedId(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [selectedId]);

  const requestCancel = useCallback(() => {
    if (hasUnsavedChanges()) setConfirm({ kind: "discard" });
    else cancelEditing();
  }, [hasUnsavedChanges, cancelEditing]);

  // Leaving Home mid-edit (the bell, a card link, the menu) used to drop the changes without a
  // word, while Cancel asked first. Links out now ask the same question; closing the tab gets
  // the browser's own warning.
  useEffect(() => {
    if (!editing) return;
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as HTMLElement | null)?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.stopPropagation();
      setConfirm({ kind: "leave", href: `${url.pathname}${url.search}${url.hash}` });
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [editing, hasUnsavedChanges]);

  // Escape is Cancel (asking first if there is anything to lose); Ctrl/Cmd+Z steps
  // back one change and Ctrl/Cmd+Shift+Z or Ctrl+Y steps forward again. Anything that
  // handles Escape itself — a drag, a picked-up card, the widget sheet, the ••• menu — goes first.
  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || confirm || boardsOpen) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest("input, textarea, select, [contenteditable='true']"));
      const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
      const key = event.key.toLowerCase();
      if (mod && ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey))) {
        if (typing) return;
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === "z" && !event.shiftKey) {
        if (typing) return;
        event.preventDefault();
        undo();
        return;
      }
      if (event.key !== "Escape" || dragging || grabbedId) return;
      event.preventDefault();
      if (selectedId) {
        setSelectedId(null);
        return;
      }
      if (libraryOpen) {
        setLibraryOpen(false);
        return;
      }
      requestCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, confirm, boardsOpen, dragging, grabbedId, libraryOpen, selectedId, setLibraryOpen, undo, redo, requestCancel]);


  if (!homeReady) return <DashboardHomeSkeleton greetingText={greetingText} />;
  if (props.accessStatus) {
    const copy = loadFailureCopy(classifyLoadFailure({ status: props.accessStatus, message }), { message, nextPath: withOrgHref("/dashboard", orgId) });
    return <main className="dash-home"><EmptyState headingLevel={1} title={copy.title} description={copy.description} badge={copy.badge}>
      {copy.kind === "auth" || copy.kind === "reauth" ? <Button as="a" variant="primary" href={copy.primary!.href}>Sign in again</Button> : null}
      {copy.kind === "forbidden" ? <Button type="button" variant="primary" onClick={props.onReloadAccess}>Reload access</Button> : null}
      <Button as="a" variant="secondary" href="/account/teams">Choose another team</Button>
    </EmptyState></main>;
  }

  // Cards Home is leaving out right now, listed under the board while editing.
  const hiddenRows = editing
    ? layout.filter((item) => hiddenOnHome.has(item.i) && !displayLayout.some((shown) => shown.i === item.i))
    : [];
  // Edit Home's rows: the cards Home shows, in the order it shows them, then the ones it is
  // leaving out right now.
  const toCustomizeRow = (item: DashboardWidgetLayout): CustomizeRow => {
    const saved = layout.find((row) => row.i === item.i) ?? item;
    return {
      id: item.i,
      type: item.type,
      label: catalogEntry(item.type)?.label ?? item.type,
      icon: WIDGET_PICKER_ICON[item.type] ?? "grid",
      size: inferWidgetSize(saved),
      hiddenReason: hiddenOnHome.get(item.i) ?? null,
      alwaysShown: isAlwaysShown(saved),
    };
  };
  const customizeRows = editing
    ? readingOrder(displayLayout).flatMap((id) => {
        const item = displayLayout.find((row) => row.i === id);
        return item ? [toCustomizeRow(item)] : [];
      })
    : [];
  const customizeHidden = editing ? hiddenRows.map(toCustomizeRow) : [];
  const teamSetupCard = Boolean(setupHero);
  const sharedSetupPrompt = Boolean(orgId && widgetsLoaded && (dashShell === "setup" || dashShell === "tba"));
  const showsOverview = false;
  // Only when something in it has a value: a strip of "Nothing waiting / No empty room slots /
  // No member checks open" on a new team looked like a report of work already done.
  // Wait for the setup steps: the strip drew while they loaded, then vanished when the setup
  // card arrived to take its place.
  const showRoleStrip = Boolean(
    orgId && firstWeek.loaded !== false && homeStripItems.some((item) => item.tone !== "neutral") && !teamSetupCard,
  );
  // Errors outside edit mode stay at the top, where the thing that failed is.
  // Everything else is a toast by the toolbar.
  const inlineError = !editing && !previewing && messageKind === "error" && message;
  // Home itself did not load (no copy on this device): one banner, one Retry.
  const homeFailed = Boolean(inlineError && message === "Could not load Home." && props.onRetryHome);
  const matchCardLeads = now.title === "Our next match" && displayLayout.some((item) => item.type === "next_match");
  const taskCardLeads = now.href === "/todos" && displayLayout.some((item) => item.type === "team_todos");
  // Exactly one setup surface while the team's setup is unfinished: the hero when nothing more
  // pressing is on, otherwise its own card under what leads (see homeSetupSurfaces).
  const surfaces = homeSetupSurfaces({ orgId, setupOpen: teamSetupCard, nowQuiet: Boolean(now.quiet), matchCardLeads, taskCardLeads, sharedSetupPrompt });
  const showDailyBrief = surfaces.nowCard;
  const heroSetup = surfaces.setup === "now" ? setupHero : null;
  const showsFirstWeek = Boolean(firstWeek.view && firstWeek.view.status === "live" && (!teamSetupCard || surfaces.setup === "card"));

  return (
    <main
      className={`dash-home scan-workbench scan-hub--dashboard${editing ? " is-editing" : ""}${
        editing && libraryOpen ? " is-library-open" : ""
      }${
        // A match is coming up: on a phone the Next match card comes before the first-week list
        // and "This week", which pushed it below the fold (dashboard-home.css).
        !editing &&
        now.title === "Our next match" &&
        (now.cta === "Open My Day" || now.cta === "Scout a match") &&
        layout.some((item) => item.type === "next_match")
          ? " match-leads"
          : ""
      }`}
      data-grid={grid.label}
      data-cols={cols}
      data-now-wide={showRoleStrip || showsFirstWeek ? "false" : "true"}
    >
      <p className="dash-live-region" role="status" aria-live="polite">
        {announce}
      </p>

      <DashboardHomeHeader
        me={me}
        orgId={orgId}
        greetingText={greetingText}
        editing={editing}
        detail={orgId ? "" : homeHeaderDetail({ meLoaded, orgId, tbaConfigured, setupRequired, eventName })}
        eventName={eventName}
      />
      {orgId ? (
        <div className={`dash-workspace${showDailyBrief ? " has-brief" : ""}`} {...dim}>
          {showDailyBrief ? <DashboardNowCard now={now} setupHero={heroSetup} loaded={widgetsLoaded !== false} orgId={orgId} editing={editing} /> : null}
          <DashboardWorkspaceActions orgId={orgId} role={role} hasEvent={Boolean(eventName || nextMatchData)} hasForms={props.hasScoutingSchemas}
            primaryHref={heroSetup ? heroSetup.href : showDailyBrief ? now.href : undefined}
            setupHrefs={surfaces.setup && setupHero ? setupHero.steps.filter((step) => !step.done).map((step) => step.href) : undefined}
            hasTaskCard={displayLayout.some(item => item.type === "team_todos")} />
        </div>
      ) : null}
      {/* "Our next match · Open My Day" on top of the Next match card said the same thing twice,
          so with a match coming up the Next match card leads. A setup step ("Add your first
          practice") waits too: it sat above Qual 31 fourteen minutes before the match. It moves
          to its own card here, under what leads, until setup is done. */}
      {/* Left unwrapped (product-motion.css animates it as a direct child);
          the edit-mode effect above makes it inert instead. */}
      {/* When Home itself failed, the banner below is the one message with the one Retry; the
          checklist does not add its own "could not load" card on top (A5-21). */}
      {orgId ? <FirstWeekCard orgId={orgId} view={firstWeek.view} busy={firstWeek.busy} post={firstWeek.post} error={homeFailed ? "" : firstWeek.error} retry={firstWeek.retry} setupHere={surfaces.setup === "card"} /> : null}
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      {showRoleStrip ? <DashboardRoleStrip orgId={orgId} audience={homeAudience} items={homeStripItems} dim={dim} /> : null}

      {homeFailed ? (
        <p className="telemetry-status dash-home-failed" role="alert">
          Home couldn&rsquo;t load just now. Nothing you saved is lost.{" "}
          <button
            type="button"
            className="app-button secondary"
            onClick={() => {
              props.onRetryHome?.();
              firstWeek.retry?.();
            }}
          >
            Retry
          </button>
        </p>
      ) : inlineError ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {onRetrySession ? (
        <p className="dash-session-failed" role="alert">
          Couldn&rsquo;t load your team just now.{" "}
          <button type="button" className="app-button secondary" onClick={onRetrySession}>
            Try again
          </button>
        </p>
      ) : null}

      {!showsOverview && surfaces.setupBannerAllowed && (sharedSetupPrompt || (dashShell !== "ready" && dashShell !== "loading" &&
      showStandaloneSetupBanner({ editing, displayLayout }))) ? (
        <DashboardSetupBanner shell={dashShell} nextActions={nextActions} setupSteps={setupSteps} compact={sharedSetupPrompt} platformAdmin={me.platformAdmin === true} />
      ) : null}

      {meLoaded && dashShell === "ready" && nextActions.length > 0 && !teamSetupCard && !showsOverview ? (
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

      {meLoaded && orgId && tbaConfigured !== false && viewLayout.some(item => ["next_match", "recent_result", "competition_snapshot", "prediction_summary", "match_schedule"].includes(item.type)) ? (
        <DataSourceDegradedBanner health={dataSourceHealth} compact canOpenTeamData={canOpenTeamData} />
      ) : null}

      {orgId || editing ? (
        <section
          ref={gridWrapRef}
          className={`dash-grid-wrap${dragging ? " dragging" : ""}${
            drag?.kind === "add" ? " receiving-widget" : ""
          }`}
          aria-label="Home widgets"
          data-testid="dash-widget-grid"
          data-dash-drag="off"
        >
          {!editing ? (
            <header className="dash-board-heading">
              <div className="dash-board-identity">
                <h2>{board?.scope === "org" ? "Team overview" : "Your overview"}</h2>
                {/* Only when there is a board to choose: "My Home ▾" on its own was one more
                    control above the cards for nothing. New and Manage boards stay in its menu. */}
                {orgId && meLoaded && switcherBoards.length > 1 ? <DashboardBoardSwitcher
                  boards={switcherBoards} board={board} saving={saving} disabled={previewing}
                  onSwitch={(id) => void switchBoard(id)} onNew={() => setNewBoardOpen(true)}
                  onManage={() => { setRenameId(null); setBoardsOpen(true); }}
                  showQuietWidgets={props.showQuietWidgets} quietWidgetCount={props.quietWidgetCount}
                  onToggleQuietWidgets={props.onToggleQuietWidgets}
                /> : null}
              </div>
              {/* One quiet control, the way a list says "Edit" in its own heading. Home refreshes
                  itself; the Refresh button lives on the "Synced" line under the cards. */}
              <div className="dash-board-tools">
                {!previewing ? <button type="button" className="dash-board-customize"
                  ref={customizeRef}
                  data-testid="dash-customize" data-tour="customise"
                  aria-label="Edit Home — rearrange, add, or remove widgets" onClick={startEditing}>
                  Edit
                </button> : null}
              </div>
            </header>
          ) : null}
          {snapFeedback ? (
            <output className="dash-snap-hud" aria-hidden="true">
              <strong>{snapFeedback.mode}</strong>
              <span>
                {snapFeedback.label}
                {snapFeedback.where ? ` · ${snapFeedback.where}` : ""}
              </span>
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
          ) : mounted && viewLayout.length === 0 && !editing && sharedSetupPrompt && layout.length > 0 ? null : mounted && viewLayout.length === 0 && !editing ? (
            <div className="dash-quiet-home" role="status">
              <strong>No widgets on this board</strong>
              <span>Tap Edit to add the cards you want to see.</span>
            </div>
          ) : (
            <div
              ref={setCanvasNode}
              className="dash-grid dash-pgrid"
              // Edit Home's panel does the editing; the board keeps looking like Home.
              data-editing="false"
              data-flow={cols === 1 ? "true" : "false"}
              data-cols={cols}
              data-testid="dash-place-canvas"
              data-measured={measured && width > 0 ? "true" : "false"}
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
                        editing={false}
                        isDragging={drag?.kind === "move" && drag.id === item.i}
                        isGrabbed={grabbedId === item.i}
                        selected={false}
                        isNew={highlightId === item.i}
                        hiddenNote={null}
                        currentSize={inferWidgetSize(saved)}
                        stretched={item.w > saved.w}
                        atDefault={!entry || (saved.w === entry.defaultW && saved.h === entry.defaultH)}
                        payload={widgets[item.type]}
                        orgId={orgId}
                        tbaConfigured={tbaConfigured}
                        canOpenTeamData={canOpenTeamData}
                        onSelect={setSelectedId}
                        // Edit Home's panel moves and resizes cards; the board is a preview.
                        onCardPointerDown={() => {}}
                        onHandlePointerDown={() => {}}
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
          {!editing && !previewing && updatedAt && orgId && !fromCache ? (
            <p className="dash-sync-foot">
              Synced · {new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
              {" · "}
              <button type="button" className="dash-sync-refresh" onClick={props.onRefresh} disabled={props.refreshing}>
                {props.refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </p>
          ) : null}
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
        <DashboardCustomizeSheet
          rows={customizeRows}
          hiddenRows={customizeHidden}
          paletteRows={paletteEntries}
          paletteIcon={(type) => WIDGET_PICKER_ICON[type] ?? "grid"}
          waiting={!meLoaded || Boolean(onRetrySession)}
          showSizes={cols > 1}
          tab={libraryOpen ? "add" : "home"}
          saving={saving}
          canUndo={canUndo}
          canShareOrg={canShareOrg}
          onTab={(next) => setLibraryOpen(next === "add")}
          onAdd={(type) => addWidget(type)}
          onRemove={removeWidget}
          onResize={setWidgetSize}
          onMove={moveWidget}
          onAlwaysShow={setAlwaysShown}
          onTidy={tidyLayout}
          onPreview={() => {
            setEditing(false);
            setPreviewing(true);
            setLibraryOpen(false);
          }}
          onSaveOrg={() => setConfirm({ kind: "team" })}
          onReset={() => setConfirm({ kind: "reset" })}
          onUndo={undo}
          onCancel={requestCancel}
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

      <DashboardHomeDialogs
        confirm={confirm}
        onConfirm={(asked, ok) => {
          setConfirm(null);
          if (asked.kind === "delete") {
            if (ok) void deleteBoard(asked.id);
            // Back to the manager the question came from.
            setBoardsOpen(true);
            return;
          }
          if (!ok) return;
          if (asked.kind === "reset") void resetDefault();
          if (asked.kind === "discard") cancelEditing();
          if (asked.kind === "leave") {
            cancelEditing();
            window.location.assign(asked.href);
          }
          if (asked.kind === "team") {
            const onTeamBoard = board?.scope === "org" && Boolean(board.id);
            void shareWithTeam().then((shared) => {
              if (!shared || onTeamBoard) return;
              setSharedBoard({ ...shared, message: `Shared as “${shared.name}”. You're still on your own board.` });
            });
          }
        }}
        board={board}
        boardsOpen={boardsOpen}
        newBoardOpen={newBoardOpen}
        personalBoards={personalBoards}
        orgBoards={orgBoards}
        saving={saving}
        editing={editing}
        canShareOrg={canShareOrg}
        renameId={renameId}
        renameDraft={renameDraft}
        onCloseBoards={() => {
          setBoardsOpen(false);
          setRenameId(null);
        }}
        onCloseNewBoard={() => setNewBoardOpen(false)}
        onRenameDraft={setRenameDraft}
        onSwitch={(id) => void switchBoard(id)}
        onRename={(id, name) => void renameBoard(id, name)}
        onDuplicate={(id) => void duplicateBoard(id)}
        onRequestDelete={(id) => {
          const target = [...personalBoards, ...orgBoards].find((item) => item.id === id);
          if (!target) return;
          setBoardsOpen(false);
          setConfirm({ kind: "delete", id, name: target.name });
        }}
        onStartRename={(id, name) => {
          setRenameId(id);
          setRenameDraft(name);
        }}
        onCancelRename={() => setRenameId(null)}
        onCreatePersonal={(name) => void createBoard("personal", name)}
        onCreateOrg={(name) => void createBoard("org", name)}
      />
    </main>
  );
}
