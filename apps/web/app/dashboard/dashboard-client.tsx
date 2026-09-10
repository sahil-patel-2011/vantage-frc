"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import PartnerPlacement from "../../components/partner-placement";
import {
  applyGridDrag,
  dropWidgetOntoLayout,
  duplicateBoardName,
  readStoredBoardId,
  writeStoredBoardId,
} from "../../lib/dashboard/boards";
import { dashboardPollDelay } from "../../lib/dashboard/refresh";
import { prefersTapToPlace } from "../../lib/dashboard/tap-to-place";
import {
  DASHBOARD_COLUMNS,
  DEFAULT_DASHBOARD_LAYOUT,
  WIDGET_CATALOG,
  WIDGET_SIZE_LABEL,
  applyWidgetSize,
  canAccessWidget,
  catalogEntry,
  homeViewLayout,
  inferWidgetSize,
  packDashboardLayout,
  scaleLayoutToCols,
  defaultDashboardLayoutForAudience,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type WidgetCatalogEntry,
  type WidgetSizeKey,
} from "../../lib/dashboard/catalog";
import {
  DRAG_CANCEL_DISTANCE,
  DRAG_LONG_PRESS_MS,
  DRAG_MOUSE_INTENT_DISTANCE,
  cellBox,
  compactLayout,
  describeCellMove,
  edgeAutoScrollDelta,
  exceedsDragCancelDistance,
  layoutBottom,
  layoutOrder,
  moveItem,
  nudgeItem,
  pointToCell,
  reorderLayout,
  type GridCell,
  type NudgeDirection,
  type PointerPoint,
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
  ARROW_DIRECTION,
  CONTEXT_REFRESH_MS,
  WIDGET_PICKER_ICON,
  greeting,
  resolveGrid,
  useMeasuredCanvas,
  widgetLockReason,
} from "./dashboard-canvas";
import { prioritizeHomeStrip, type HomeStripItem } from "../../lib/home-workflows";
import { Button } from "../../components/ui";
import {
  type BoardMeta,
  type BoardState,
  type DragActivation,
  type DragSession,
  type DragView,
  type Me,
  type PaletteRow,
  type SnapFeedback,
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
  const [dragging, setDragging] = useState(false);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [snapFeedback, setSnapFeedback] = useState<SnapFeedback | null>(null);
  const [announce, setAnnounce] = useState("");
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const orgId = me.orgId ?? "";
  const userId = me.userId ?? "";
  const { cheatOpen, setCheatOpen, shortcuts } = useVenueShortcuts(orgId || null);

  const dragRef = useRef<DragSession | null>(null);
  const proxyRef = useRef<HTMLDivElement | null>(null);
  const longPressRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const keyListenerRef = useRef<((event: KeyboardEvent) => void) | null>(null);
  const touchListenerRef = useRef<((event: TouchEvent) => void) | null>(null);
  const suppressClickRef = useRef(false);
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
      setMessage("Select a team to save a custom layout.");
      return;
    }
    if (activateScope === "org" && !canShareOrg) {
      setMessageKind("error");
      setMessage("Owner/admin access required for org-shared dashboards.");
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
      setLayout(data.layout?.length ? data.layout : DEFAULT_DASHBOARD_LAYOUT);
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
      setMessage("Owner/admin access required for team boards.");
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
          layout: DEFAULT_DASHBOARD_LAYOUT,
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
      setMessage("Owner/admin access required to delete team boards.");
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
    setLayout(board?.layout ?? DEFAULT_DASHBOARD_LAYOUT);
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
      setLayout(
        defaultDashboardLayoutForAudience(
          (context.homeStrip as { audience?: string } | undefined)?.audience === "mentor"
            ? "mentor"
            : "student",
        ),
      );
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
      const nextLayout: DashboardWidgetLayout[] = Array.isArray(data.layout)
        ? data.layout
        : DEFAULT_DASHBOARD_LAYOUT;
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

  /* ------------------------------------------------------------------ *
   * Pointer drag — one code path for mouse, touch and pen.
   * ------------------------------------------------------------------ */

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

  function canvasRect() {
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
    // Anchor on the ghost's top-left corner, nudged inside so it reads the cell
    // the card visually covers rather than the one just before it.
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
    session: Omit<DragSession, "pointerId" | "captureTarget" | "active" | "origin" | "point" | "baseLayout" | "baseDisplay">,
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
      rowHeight: grid.rowHeight,
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
    const box = cellBox({ x: 0, y: 0, ...span }, canvasWidth, cols, grid.rowHeight, gap);
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
      rowHeight: grid.rowHeight,
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
      // Past the slop before the long press fired: that gesture was a scroll.
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
      // The browser still fires a click on the palette chip after the drag —
      // swallow exactly one, and drop the guard again if it never arrives.
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 400);
      // An empty board renders the CTA instead of a canvas — there is nothing
      // to miss, so any release counts as a placement.
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
    // Unmount cleanup only.
    [],
  );

  // Leaving edit mode mid-gesture must not strand a captured pointer.
  useEffect(() => {
    if (!editing && dragRef.current) endDrag(true);
    if (!editing) setGrabbedId(null);
  }, [editing]);

  /* ------------------------------------------------------------------ *
   * Keyboard reordering — space picks up, arrows move, space drops.
   * ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------ */

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
  const quickStart = [
    {
      id: "my-day",
      label: "My day",
      detail: "Assignments and next match",
      href: withOrgHref("/my-day", orgId || null),
      icon: "calendar" as const,
    },
    {
      id: "scout",
      label: "Scout",
      detail: "Open your event form",
      href: hubHref("/competition", "scouting", orgId || null),
      icon: "clipboard" as const,
    },
    {
      id: "work",
      label: "Work",
      detail: "Your open team tasks",
      href: withOrgHref("/todos", orgId || null),
      icon: "grid" as const,
    },
    {
      id: "messages",
      label: "Messages",
      detail: "Team channels and DMs",
      href: hubHref("/team", "messages", orgId || null),
      icon: "chat" as const,
    },
  ];

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
