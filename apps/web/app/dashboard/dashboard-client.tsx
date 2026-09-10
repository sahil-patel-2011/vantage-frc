"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import PartnerPlacement from "../../components/partner-placement";
import {
  readStoredBoardId,
  writeStoredBoardId,
} from "../../lib/dashboard/boards";
import { useDashboardPointerDrag } from "./use-dashboard-pointer-drag";
import { useDashboardBoardOps } from "./use-dashboard-board-ops";
import { dashboardPollDelay } from "../../lib/dashboard/refresh";
import { prefersTapToPlace } from "../../lib/dashboard/tap-to-place";
import {
  DASHBOARD_COLUMNS,
  DEFAULT_DASHBOARD_LAYOUT,
  WIDGET_CATALOG,
  canAccessWidget,
  catalogEntry,
  homeViewLayout,
  inferWidgetSize,
  scaleLayoutToCols,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
} from "../../lib/dashboard/catalog";
import {
  cellBox,
  compactLayout,
  layoutBottom,
} from "../../lib/dashboard/grid-drag";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import {
  classifyDashboardShell,
  dashboardNextActions,
  dashboardSetupSteps,
  type DashboardShellKind,
} from "../../lib/dashboard/dashboard-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { Icon } from "../../components/icon";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import type { DataSourceHealthView } from "../../lib/reference-health";
import { DashboardGridItem } from "./dashboard-grid-item";
import { LiveCountdown } from "./widgets";
import {
  CONTEXT_REFRESH_MS,
  WIDGET_PICKER_ICON,
  greeting,
  homeQuickStart,
  resolveGrid,
  useMeasuredCanvas,
  widgetLockReason,
} from "./dashboard-canvas";
import { prioritizeHomeStrip, type HomeStripItem } from "../../lib/home-workflows";
import { Button } from "../../components/ui";
import {
  type BoardMeta,
  type BoardState,
  type Me,
  type PaletteRow,
} from "./dashboard-board-types";
import { DashboardBoardBar } from "./dashboard-board-bar";
import { DashboardBoardsModal } from "./dashboard-boards-modal";
import { DashboardEditDock, DashboardPreviewDock } from "./dashboard-edit-dock";
import { DashboardSetupBanner } from "./dashboard-setup-banner";
import { DashboardWidgetLibrary } from "./dashboard-widget-library";
import { DashboardWidgetPalette } from "./dashboard-widget-palette";
import { CopyShareLink } from "../../components/copy-share-link";
import { useVenueShortcuts, VenueShortcutCheatsheet } from "../../hooks/use-venue-shortcuts";
import {
  mergeDashboardContext,
  mergeDashboardWidgets,
  snapshotPollWidgetTypes,
} from "../../lib/dashboard/refresh";
import { fetchProductSession } from "../../lib/nav/product-session";
import { persistOrgIdInUrl, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import "./dashboard-dnd.css";

export default function DashboardClient({ initialOrgId = "" }: { initialOrgId?: string }) {
  const { setNode: setCanvasNode, node: canvasNode, width, mounted, measured } = useMeasuredCanvas();
  const [me, setMe] = useState<Me>({ orgId: initialOrgId || undefined });
  const [board, setBoard] = useState<BoardState | null>(null);
  const [layout, setLayout] = useState<DashboardWidgetLayout[]>(DEFAULT_DASHBOARD_LAYOUT);
  const [widgets, setWidgets] = useState<Record<string, WidgetPayload>>({});
  const [context, setContext] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingPlaceType, setPendingPlaceType] = useState<DashboardWidgetType | null>(null);
  const [scope, setScope] = useState<"personal" | "org">("personal");
  const [canShareOrg, setCanShareOrg] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const orgId = me.orgId ?? "";
  const userId = me.userId ?? "";
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(orgId || null);

  const layoutRef = useRef(layout);
  const displayRef = useRef<DashboardWidgetLayout[]>([]);
  const grabBaseRef = useRef<DashboardWidgetLayout[] | null>(null);
  const shellRef = useRef<DashboardShellKind>("loading");

  const loadSnapshot = useCallback(async (
    id: string,
    types?: DashboardWidgetType[],
    opts?: { fullContext?: boolean; signal?: AbortSignal },
  ) => {
    const requested = types ?? snapshotPollWidgetTypes(layoutRef.current, { shell: shellRef.current });
    const qs = new URLSearchParams({ orgId: id, mode: "snapshot" });
    if (requested.length) qs.set("widgets", [...new Set(requested)].join(","));
    if (opts?.fullContext) qs.set("context", "full");
    const response = await fetch(`/api/dashboards?${qs.toString()}`, { signal: opts?.signal });
    if (!response.ok) return;
    const data = await response.json();
    setWidgets((current) => mergeDashboardWidgets(current, data.widgets));
    setContext((current) => mergeDashboardContext(current, data.context));
    setUpdatedAt(new Date().toISOString());
  }, []);

  const loadHome = useCallback(async (id: string, preferredBoardId?: string | null) => {
    const stored = preferredBoardId === undefined ? readStoredBoardId(id, userId) : preferredBoardId;
    const qs = new URLSearchParams({ orgId: id, mode: "home" });
    if (stored) qs.set("boardId", stored);
    const response = await fetch(`/api/dashboards?${qs.toString()}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setMessageKind("error");
      setMessage(err.error ?? "Could not load dashboard");
      return;
    }
    const data = await response.json();
    const nextLayout = data.active?.layout?.length ? data.active.layout : DEFAULT_DASHBOARD_LAYOUT;
    setRole(data.role ?? null);
    setCanShareOrg(Boolean(data.canShareOrg));
    setBoards(Array.isArray(data.boards) ? data.boards : []);
    setBoard(data.active);
    setScope(data.active?.scope === "org" ? "org" : "personal");
    setLayout(nextLayout);
    setWidgets(data.widgets ?? {});
    setContext(data.context ?? {});
    setUpdatedAt(new Date().toISOString());
    if (data.active?.id) writeStoredBoardId(id, userId, data.active.id);
  }, [userId]);

  useEffect(() => {
    const fromUrl = readOrgIdFromSearch(window.location.search) ?? initialOrgId;
    void fetchProductSession(fromUrl || null)
      .then((data) => {
        if (!data) return;
        const nextOrg = typeof data.orgId === "string" && data.orgId ? data.orgId : fromUrl;
        setMe({
          userId: typeof data.userId === "string" ? data.userId : undefined,
          name: data.firstName || data.name || undefined,
          orgId: nextOrg || undefined,
          orgName: data.orgName,
          teamNumber: data.teamNumber,
          role: data.role,
          tbaConfigured: data.tbaConfigured,
        });
        setRole(data.role ?? null);
        if (typeof data.tbaConfigured === "boolean") {
          setContext((current) => ({ ...current, tbaConfigured: data.tbaConfigured }));
        }
        if (nextOrg && !readOrgIdFromSearch(window.location.search)) persistOrgIdInUrl(nextOrg);
      })
      .catch(() => undefined)
      .finally(() => setMeLoaded(true));
  }, [initialOrgId]);

  useEffect(() => {
    if (!orgId) {
      setLayout(DEFAULT_DASHBOARD_LAYOUT);
      setBoard({
        id: null,
        name: "Default home",
        scope: "personal",
        layout: DEFAULT_DASHBOARD_LAYOUT,
        isDefault: true,
      });
      return;
    }
    void loadHome(orgId);
    let cancelled = false;
    let timer: number | null = null;
    let inFlight: AbortController | null = null;
    let lastFull = Date.now();

    const poll = async () => {
      if (cancelled || document.visibilityState === "hidden" || inFlight) return;
      const controller = new AbortController();
      inFlight = controller;
      const fullContext = Date.now() - lastFull >= CONTEXT_REFRESH_MS;
      try {
        await loadSnapshot(orgId, undefined, { fullContext, signal: controller.signal });
        if (fullContext) lastFull = Date.now();
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      } finally {
        if (inFlight === controller) inFlight = null;
      }
    };

    const schedule = () => {
      timer = window.setTimeout(() => {
        void poll().finally(() => {
          if (!cancelled) schedule();
        });
      }, dashboardPollDelay(document.visibilityState === "hidden"));
    };
    schedule();

    const onVisibility = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [orgId, loadHome, loadSnapshot]);

  useEffect(() => {
    document.body.classList.toggle("dash-editing", editing || previewing);
    return () => document.body.classList.remove("dash-editing");
  }, [editing, previewing]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("customize") === "1") {
      setEditing(true);
      setLibraryOpen(true);
      params.delete("customize");
      const next = params.toString();
      const cleaned = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", cleaned);
      window.requestAnimationFrame(() => {
        document.querySelector(".dash-grid-wrap")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, []);

  /** Every catalog entry with a reason it cannot be added, so nothing fails silently. */
  const paletteEntries = useMemo<PaletteRow[]>(
    () =>
      WIDGET_CATALOG.map((entry) => {
        if (layout.some((item) => item.type === entry.type)) {
          return { entry, status: "placed", reason: null };
        }
        if (!canAccessWidget(entry.type, role)) {
          return { entry, status: "locked", reason: widgetLockReason(entry) };
        }
        return { entry, status: "add", reason: null };
      }),
    [layout, role],
  );
  const addableEntries = useMemo(
    () => paletteEntries.filter((row) => row.status === "add"),
    [paletteEntries],
  );

  const personalBoards = useMemo(() => boards.filter((item) => item.scope === "personal"), [boards]);
  const orgBoards = useMemo(() => boards.filter((item) => item.scope === "org"), [boards]);
  const switcherBoards = useMemo(() => {
    const ordered = [...personalBoards, ...orgBoards];
    if (board?.id && !ordered.some((item) => item.id === board.id) && !board.isDefault) {
      return [
        { id: board.id, name: board.name, scope: board.scope, isActive: true } satisfies BoardMeta,
        ...ordered,
      ];
    }
    return ordered;
  }, [personalBoards, orgBoards, board]);

  const firstName = (me.name ?? "coach").split(" ")[0] || "coach";
  const tbaConfigured =
    typeof context.tbaConfigured === "boolean"
      ? context.tbaConfigured
      : typeof me.tbaConfigured === "boolean"
        ? me.tbaConfigured
        : undefined;
  const setupRequired = Boolean(context.setupRequired);
  const hasScoutingSchemas = Boolean(context.hasScoutingSchemas);
  const hasAiProvider = Boolean(context.hasAiProvider);
  const dataSourceHealth =
    context.dataSourceHealth && typeof context.dataSourceHealth === "object"
      ? (context.dataSourceHealth as DataSourceHealthView)
      : null;
  const homeStripRaw = context.homeStrip as
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
  const nextMatchPayload = widgets.next_match;
  const nextMatchData =
    nextMatchPayload?.status === "live" ? (nextMatchPayload.data as Record<string, unknown> | undefined) : undefined;
  const dashShell = classifyDashboardShell({
    loaded: meLoaded || Boolean(orgId && updatedAt),
    orgId: orgId || null,
    setupRequired,
    tbaConfigured,
  });
  shellRef.current = dashShell;
  const nextActions = dashboardNextActions({
    orgId: orgId || null,
    shell: dashShell,
    hasScoutingSchemas,
    hasAiProvider,
    role,
  });
  const setupSteps = dashboardSetupSteps({
    orgId: orgId || null,
    setupRequired,
    tbaConfigured,
    hasScoutingSchemas,
    hasAiProvider,
    role,
  });

  const viewLayout = useMemo(
    () => homeViewLayout(layout, { editing, shell: dashShell, widgets }),
    [layout, editing, dashShell, widgets],
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
    displayRef.current = displayLayout;
  }, [displayLayout]);

  const gridRows = Math.max(layoutBottom(displayLayout), editing ? 4 : 1);
  const gridHeight = gridRows * grid.rowHeight + Math.max(0, gridRows - 1) * gap;

  const {
    addWidget,
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
    resetAudience: homeAudience === "mentor" ? "mentor" : "student",
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
    editing,
    saving,
    canvasNode,
    cols,
    gap,
    rowHeight: grid.rowHeight,
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
            {!meLoaded
              ? "Loading your team…"
              : !orgId
                ? "Select a team to load live data."
                : tbaConfigured === false
                  ? "Your week — what is next, what is due, and what to learn. Match data arrives once The Blue Alliance is connected below."
                  : setupRequired
                    ? "Select an active event to load competition data."
                    : context.eventName
                      ? String(context.eventName)
                      : "Home — widgets appear when live data exists."}
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
              {tbaConfigured === false ? "Connect TBA" : "Select event"}
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
              {updatedAt && orgId && !editing ? (
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

      {meLoaded && dashShell !== "ready" ? (
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
            if (prefersTapToPlace({
              pointerType: "pointerType" in event.nativeEvent ? String(event.nativeEvent.pointerType) : "",
              coarse: window.matchMedia("(pointer: coarse)").matches,
            })) {
              setPendingPlaceType(entry.type);
              setMessageKind("success");
              setMessage(`Tap a slot on the board to place ${entry.label}.`);
              setAnnounce(`Tap a slot on the board to place ${entry.label}.`);
              return;
            }
            addWidget(entry.type);
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

      <DashboardWidgetLibrary
        open={editing && libraryOpen}
        onClose={() => setLibraryOpen(false)}
        addableEntries={addableEntries}
        paletteEntries={paletteEntries}
        onPick={(entry) => {
          if (
            prefersTapToPlace({
              coarse: window.matchMedia("(pointer: coarse)").matches,
            })
          ) {
            setPendingPlaceType(entry.type);
            setLibraryOpen(false);
            setMessageKind("success");
            setMessage(`Tap a slot on the board to place ${entry.label}.`);
            setAnnounce(`Tap a slot on the board to place ${entry.label}.`);
            return;
          }
          addWidget(entry.type);
        }}
      />

      <DashboardBoardsModal
        open={boardsOpen}
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
    </main>
  );
}
