"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
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
import {
  DASHBOARD_COLUMNS,
  DEFAULT_DASHBOARD_LAYOUT,
  WIDGET_CATALOG,
  WIDGET_SIZE_LABEL,
  applyWidgetSize,
  canAccessWidget,
  catalogEntry,
  dashboardGridForWidth,
  homeViewLayout,
  inferWidgetSize,
  packDashboardLayout,
  scaleLayoutToCols,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
  type OrgRole,
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
  dashboardSetupBlurb,
  dashboardSetupSteps,
  dashboardSetupTitle,
  type DashboardShellKind,
} from "../../lib/dashboard/dashboard-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import { Icon } from "../../components/icon";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import type { DataSourceHealthView } from "../../lib/reference-health";
import { DashboardGridItem } from "./dashboard-grid-item";
import { Badge, Modal } from "../../components/ui";
import { useVenueShortcuts, VenueShortcutCheatsheet } from "../../hooks/use-venue-shortcuts";
import {
  mergeDashboardContext,
  mergeDashboardWidgets,
  snapshotPollWidgetTypes,
} from "../../lib/dashboard/refresh";
import { fetchProductSession } from "../../lib/nav/product-session";
import { persistOrgIdInUrl, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import "./dashboard-dnd.css";

type Me = {
  userId?: string;
  name?: string;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  teamRole?: string | null;
  crewRole?: string | null;
  primaryFocus?: string | null;
  tbaConfigured?: boolean;
};

type BoardMeta = {
  id: string;
  name: string;
  scope: "personal" | "org";
  isActive: boolean;
  updatedAt?: string | null;
  ownerUserId?: string | null;
};

type BoardState = {
  id: string | null;
  name: string;
  scope: "personal" | "org";
  layout: DashboardWidgetLayout[];
  isDefault?: boolean;
};

type SnapFeedback = {
  mode: "Moving" | "Placing";
  x: number;
  y: number;
  w: number;
  h: number;
};

const POLL_MS = 30_000;
const CONTEXT_REFRESH_MS = 5 * 60_000;

/** Below this container width the board becomes a single scrollable column. */
const SINGLE_COLUMN_MAX = 720;

const ARROW_DIRECTION: Record<string, NudgeDirection | undefined> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const WIDGET_PICKER_ICON: Partial<Record<DashboardWidgetType, "swords" | "cube" | "bolt" | "bell" | "grid" | "stats" | "target" | "clipboard" | "gear" | "display" | "chat" | "pin" | "calendar">> = {
  next_match: "swords",
  robot_readiness: "cube",
  prediction_summary: "bolt",
  alerts: "bell",
  quick_actions: "grid",
  recent_result: "stats",
  competition_snapshot: "target",
  scouting_coverage: "clipboard",
  sync_status: "gear",
  pit_youtube: "display",
  notifications: "bell",
  ai_usage: "bolt",
  onboarding_checklist: "pin",
  team_todos: "clipboard",
  subteam_upcoming: "calendar",
};

const ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  scout: "Scout",
  viewer: "Viewer",
};

/** Why the catalog is holding a widget back — read straight off the entry. */
function widgetLockReason(entry: WidgetCatalogEntry): string {
  const roles = entry.roles ?? [];
  if (roles.length === 0) return "Not available on this workspace";
  const names = roles.map((role) => ROLE_LABEL[role] ?? role);
  if (names.length === 1) return `${names[0]} only`;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]} only`;
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Phone/tablet/laptop grid, collapsed to one column on a narrow canvas. */
function resolveGrid(width: number) {
  if (width <= 0) {
    return { ...dashboardGridForWidth(390), cols: 1, rowHeight: 78, margin: [12, 12] as [number, number] };
  }
  const base = dashboardGridForWidth(width);
  if (width < SINGLE_COLUMN_MAX) {
    return { ...base, cols: 1, rowHeight: 78, margin: [12, 12] as [number, number] };
  }
  return base;
}

/** ResizeObserver on the grid canvas — the drag maths needs its exact box. */
function useMeasuredCanvas() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [measured, setMeasured] = useState(false);

  useEffect(() => setMounted(true), []);

  // Reflow motion stays off for one frame after the first measurement, so cards
  // snap from the server-render fallback width instead of animating from it.
  useEffect(() => {
    if (width <= 0 || measured) return;
    const frame = window.requestAnimationFrame(() => setMeasured(true));
    // rAF is paused in a background tab; the timer keeps the board from being
    // stuck without reflow motion until the tab is focused.
    const timer = window.setTimeout(() => setMeasured(true), 150);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [width, measured]);

  useEffect(() => {
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? node.clientWidth;
      setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { setNode, node, width, mounted, measured };
}

type DragKind = "move" | "add";
/** immediate = dedicated handle; longpress = card body / touch; intent = mouse on the palette. */
type DragActivation = "immediate" | "longpress" | "intent";

type DragSession = {
  kind: DragKind;
  id: string;
  type: DashboardWidgetType;
  label: string;
  pointerId: number;
  captureTarget: Element | null;
  activation: DragActivation;
  active: boolean;
  origin: PointerPoint;
  point: PointerPoint;
  grab: PointerPoint;
  size: { width: number; height: number };
  span: { w: number; h: number };
  cell: GridCell;
  cols: number;
  rowHeight: number;
  gap: number;
  baseLayout: DashboardWidgetLayout[];
  baseDisplay: DashboardWidgetLayout[];
};

type DragView = {
  kind: DragKind;
  id: string;
  type: DashboardWidgetType;
  label: string;
  cell: GridCell;
  span: { w: number; h: number };
  size: { width: number; height: number };
};

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
          teamRole: data.teamRole,
          crewRole: data.crewRole,
          primaryFocus: typeof data.primaryFocus === "string" ? data.primaryFocus : null,
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
      }, POLL_MS);
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
  const paletteEntries = useMemo(
    () =>
      WIDGET_CATALOG.map((entry) => {
        if (layout.some((item) => item.type === entry.type)) {
          return { entry, status: "placed" as const, reason: null as string | null };
        }
        if (!canAccessWidget(entry.type, role)) {
          return { entry, status: "locked" as const, reason: widgetLockReason(entry) };
        }
        return { entry, status: "add" as const, reason: null as string | null };
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
    if (orgId) void loadSnapshot(orgId, result.layout.map((item) => item.type));
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
      setMessage("Select a team workspace to save a custom layout.");
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
      setLayout(DEFAULT_DASHBOARD_LAYOUT);
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

  return (
    <main
      className={`dash-home${editing ? " is-editing" : ""}`}
      data-grid={grid.label}
      data-cols={cols}
      data-setup={dashShell !== "ready" ? "1" : undefined}
    >
      <p className="dash-live-region" role="status" aria-live="polite">
        {announce}
      </p>

      <header className="dash-home-header">
        <div>
          <span className="breadcrumbs">
            {me.orgName ?? "Workspace"} {me.teamNumber ? `· ${me.teamNumber}` : ""}
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
          {!meLoaded ? (
            <p>Loading your workspace…</p>
          ) : dashShell === "ready" && context.eventName ? (
            <p>{String(context.eventName)}</p>
          ) : null}
        </div>
        <div className="dash-home-actions">
          {!orgId ? (
            <a className="app-button" href="/workspace">
              Select workspace
            </a>
          ) : null}
          {!editing && !previewing && orgId ? (
            <button
              className="dash-edit-quiet"
              type="button"
              data-testid="dash-customize"
              aria-label="Edit Home — rearrange, add, or remove widgets"
              onClick={enterEditMode}
            >
              Edit
            </button>
          ) : null}
        </div>
      </header>
      <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

      {message ? (
        <p className={`telemetry-status${messageKind === "success" ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {orgId && meLoaded && editing && switcherBoards.length > 1 ? (
        <div className="dash-board-bar" role="navigation" aria-label="Dashboard boards">
          <div className="dash-board-switcher" data-testid="dash-board-switcher">
            {switcherBoards.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={board?.id === item.id}
                disabled={saving || editing}
                onClick={() => void switchBoard(item.id)}
                title={item.scope === "org" ? "Team board" : "Personal board"}
              >
                {item.name}
              </button>
            ))}
            <button
              type="button"
              className="dash-board-add"
              disabled={saving || editing}
              aria-label="Create personal board"
              title="New personal board"
              onClick={() => void createBoard("personal")}
            >
              +
            </button>
          </div>
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
        </div>
      ) : null}

      {meLoaded && dashShell !== "ready" ? (
        <section className="dash-setup-banner" aria-label="First-run setup">
          <div>
            <Badge tone="setup">Setup</Badge>
            <h2>{dashboardSetupTitle(dashShell)}</h2>
            <p>{dashboardSetupBlurb(dashShell)}</p>
          </div>
          {(() => {
            const primary =
              nextActions.find((a) => a.primary) ??
              setupSteps.find((s) => s.state === "current") ??
              null;
            if (!primary) return null;
            const href = "href" in primary ? primary.href : "#";
            const label =
              "label" in primary
                ? primary.id === "invite"
                  ? "Open invite"
                  : primary.id === "tba"
                    ? "Connect TBA"
                    : primary.id === "event"
                      ? "Set event"
                      : primary.label
                : "Continue";
            return (
              <a className="app-button" href={href}>
                {label}
              </a>
            );
          })()}
        </section>
      ) : null}

      {meLoaded && orgId && tbaConfigured !== false ? (
        <DataSourceDegradedBanner health={dataSourceHealth} />
      ) : null}

      {meLoaded && (dashShell === "ready" || editing) ? (
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
              <small>Hold to drag · S/M/L/XL resize · space + arrows from the keyboard</small>
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
              onClick={() => setLibraryOpen(true)}
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
        <div className="dash-edit-dock" role="toolbar" aria-label="Home Screen edit actions">
          <button className="dash-dock-ghost" type="button" disabled={saving} onClick={cancelEditing}>
            Cancel
          </button>
          <button
            className="dash-dock-add"
            type="button"
            data-testid="dash-open-library"
            aria-pressed={libraryOpen}
            onClick={() => setLibraryOpen((open) => !open)}
          >
            <span aria-hidden="true">+</span>
            Add
          </button>
          <button className="dash-dock-done" type="button" disabled={saving} onClick={() => void save("personal")}>
            {saving ? "Saving…" : "Done"}
          </button>
        </div>
      ) : null}

      {!editing && !previewing && orgId ? <PartnerPlacement orgId={orgId} surface="dashboard_footer" title="Partners powering this season" /> : null}

      <Modal
        open={editing && libraryOpen}
        onClose={() => setLibraryOpen(false)}
        title="Widget library"
        description="One of each type per board. Tap to add, then drag the card into place."
        variant="sheet"
      >
        {addableEntries.length === 0 ? (
          <p className="dash-library-empty">Every widget you can use is already on your Home Screen.</p>
        ) : (
          <ul className="dash-library-grid">
            {addableEntries.map(({ entry }) => {
              const icon = WIDGET_PICKER_ICON[entry.type] ?? "grid";
              return (
                <li key={entry.type}>
                  <button type="button" onClick={() => addWidget(entry.type)} title={entry.description}>
                    <i>
                      <Icon name={icon} />
                    </i>
                    <strong>{entry.label}</strong>
                    <span>{entry.description}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="dash-library-onboard">
          <p>Not addable right now</p>
          <div className="dash-catalog">
            {paletteEntries
              .filter((row) => row.status !== "add")
              .map(({ entry, status, reason }) => (
                <button key={entry.type} type="button" disabled title={reason ?? undefined}>
                  {status === "placed" ? `On board · ${entry.label}` : `${entry.label} · ${reason}`}
                </button>
              ))}
            {paletteEntries.every((row) => row.status === "add") ? (
              <p className="dash-library-empty">Nothing is held back — every widget is available.</p>
            ) : null}
          </div>
        </div>
      </Modal>

      <Modal
        open={boardsOpen}
        onClose={() => {
          setBoardsOpen(false);
          setRenameId(null);
        }}
        title="Home Screens"
        description="Personal boards are yours. Team boards are shared — owner/admin can create and edit them."
        variant="sheet"
      >
            <section className="dash-boards-group">
              <p>Personal</p>
              {personalBoards.length === 0 ? (
                <p className="dash-library-empty">No saved personal boards yet — create one to keep a custom layout.</p>
              ) : (
                <ul className="dash-boards-list">
                  {personalBoards.map((item) => (
                    <li key={item.id} data-active={board?.id === item.id ? "true" : "false"}>
                      {renameId === item.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renameBoard(item.id, renameDraft);
                          }}
                        >
                          <input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            maxLength={80}
                            autoFocus
                            aria-label="Board name"
                          />
                        </form>
                      ) : (
                        <button type="button" className="dash-board-pick" disabled={saving || editing} onClick={() => void switchBoard(item.id)}>
                          <strong>{item.name}</strong>
                          <span>{board?.id === item.id ? "Current" : "Personal"} · tap to open</span>
                        </button>
                      )}
                      <div className="dash-boards-actions">
                        {renameId === item.id ? (
                          <>
                            <button type="button" disabled={saving} onClick={() => void renameBoard(item.id, renameDraft)}>
                              Save
                            </button>
                            <button type="button" disabled={saving} onClick={() => setRenameId(null)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                setRenameId(item.id);
                                setRenameDraft(item.name);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              data-testid="dash-duplicate-board"
                              disabled={saving || editing}
                              onClick={() => void duplicateBoard(item.id)}
                            >
                              Duplicate
                            </button>
                            <button type="button" className="danger" disabled={saving} onClick={() => void deleteBoard(item.id)}>
                              Delete
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="dash-boards-create">
                <button type="button" disabled={saving || editing} onClick={() => void createBoard("personal")}>
                  + New personal board
                </button>
              </div>
            </section>

            <section className="dash-boards-group">
              <p>Team</p>
              {orgBoards.length === 0 ? (
                <p className="dash-library-empty">
                  {canShareOrg
                    ? "No team boards yet — create a shared Home Screen for the whole org."
                    : "No team boards published yet."}
                </p>
              ) : (
                <ul className="dash-boards-list">
                  {orgBoards.map((item) => (
                    <li key={item.id} data-active={board?.id === item.id ? "true" : "false"}>
                      {renameId === item.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void renameBoard(item.id, renameDraft);
                          }}
                        >
                          <input
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.target.value)}
                            maxLength={80}
                            autoFocus
                            aria-label="Board name"
                          />
                        </form>
                      ) : (
                        <button type="button" className="dash-board-pick" disabled={saving || editing} onClick={() => void switchBoard(item.id)}>
                          <strong>{item.name}</strong>
                          <span>{board?.id === item.id ? "Current" : "Shared"} · tap to open</span>
                        </button>
                      )}
                      <div className="dash-boards-actions">
                        {canShareOrg ? (
                          renameId === item.id ? (
                            <>
                              <button type="button" disabled={saving} onClick={() => void renameBoard(item.id, renameDraft)}>
                                Save
                              </button>
                              <button type="button" disabled={saving} onClick={() => setRenameId(null)}>
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={saving}
                                onClick={() => {
                                  setRenameId(item.id);
                                  setRenameDraft(item.name);
                                }}
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                data-testid="dash-duplicate-board"
                                disabled={saving || editing}
                                onClick={() => void duplicateBoard(item.id)}
                              >
                                Copy to mine
                              </button>
                              <button type="button" className="danger" disabled={saving} onClick={() => void deleteBoard(item.id)}>
                                Delete
                              </button>
                            </>
                          )
                        ) : (
                          <>
                            <button type="button" disabled={saving || editing} onClick={() => void switchBoard(item.id)}>
                              Open
                            </button>
                            {/* Members cannot edit a shared board — but they can fork it. */}
                            <button
                              type="button"
                              data-testid="dash-duplicate-board"
                              disabled={saving || editing}
                              onClick={() => void duplicateBoard(item.id)}
                            >
                              Copy to mine
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {canShareOrg ? (
                <div className="dash-boards-create">
                  <button type="button" disabled={saving || editing} onClick={() => void createBoard("org")}>
                    + New team board
                  </button>
                </div>
              ) : null}
            </section>
      </Modal>
    </main>
  );
}
