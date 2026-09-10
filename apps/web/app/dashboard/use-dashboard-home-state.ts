"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readStoredBoardId,
  writeStoredBoardId,
} from "../../lib/dashboard/boards";
import { dashboardPollDelay, mergeDashboardContext, mergeDashboardWidgets, snapshotPollWidgetTypes } from "../../lib/dashboard/refresh";
import {
  defaultDashboardLayoutForAudience,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
} from "../../lib/dashboard/catalog";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import type { DashboardShellKind } from "../../lib/dashboard/dashboard-related";
import { homeAudienceFromTeamRole } from "../../lib/home-workflows";
import { fetchProductSession } from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS, persistOrgIdInUrl, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { CONTEXT_REFRESH_MS } from "./dashboard-canvas";
import type { BoardMeta, BoardState, Me } from "./dashboard-board-types";
import {
  dashboardCacheFromHomePayload,
  isDashboardOfflineCache,
  normalizeDashboardCache,
  type DashboardOfflineCache,
} from "./dashboard-offline-cache";

/**
 * Session, board load, snapshot poll, and the URL customize flag. The client
 * keeps measurement, mutations, drag, and the painted grid.
 */
export function useDashboardHomeState(initialOrgId = "") {
  const [me, setMe] = useState<Me>({ orgId: initialOrgId || undefined });
  const [board, setBoard] = useState<BoardState | null>(null);
  const [layout, setLayout] = useState<DashboardWidgetLayout[]>(() =>
    defaultDashboardLayoutForAudience("student"),
  );
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [grabbedId, setGrabbedId] = useState<string | null>(null);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const orgId = me.orgId ?? "";
  const userId = me.userId ?? "";

  const layoutRef = useRef(layout);
  const displayRef = useRef<DashboardWidgetLayout[]>([]);
  const grabBaseRef = useRef<DashboardWidgetLayout[] | null>(null);
  const shellRef = useRef<DashboardShellKind>("loading");
  const lastCacheRef = useRef<DashboardOfflineCache | null>(null);
  const widgetsRef = useRef(widgets);
  const contextRef = useRef(context);

  const applyHomeCache = useCallback((cache: DashboardOfflineCache) => {
    const next = normalizeDashboardCache(cache);
    lastCacheRef.current = next;
    widgetsRef.current = next.widgets;
    contextRef.current = next.context;
    setRole(next.role);
    setCanShareOrg(next.canShareOrg);
    setBoards(next.boards);
    setBoard(next.board);
    setScope(next.scope);
    setLayout(next.layout);
    setWidgets(next.widgets);
    setContext(next.context);
  }, []);

  const loadSnapshot = useCallback(async (
    id: string,
    types?: DashboardWidgetType[],
    opts?: { fullContext?: boolean; signal?: AbortSignal },
  ) => {
    const requested = types ?? snapshotPollWidgetTypes(layoutRef.current, { shell: shellRef.current });
    const qs = new URLSearchParams({ orgId: id, mode: "snapshot" });
    if (requested.length) qs.set("widgets", [...new Set(requested)].join(","));
    if (opts?.fullContext) qs.set("context", "full");
    const timeout = AbortSignal.timeout(FEATURE_API_TIMEOUT_MS);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const response = await fetch(`/api/dashboards?${qs.toString()}`, { signal });
    if (!response.ok) return;
    const data = await response.json();
    const nextWidgets = mergeDashboardWidgets(widgetsRef.current, data.widgets);
    const nextContext = mergeDashboardContext(contextRef.current, data.context);
    widgetsRef.current = nextWidgets;
    contextRef.current = nextContext;
    setWidgets(nextWidgets);
    setContext(nextContext);
    setUpdatedAt(new Date().toISOString());
    const prev = lastCacheRef.current;
    if (prev) {
      const nextCache: DashboardOfflineCache = { ...prev, widgets: nextWidgets, context: nextContext };
      lastCacheRef.current = nextCache;
      void putFeatureSnapshot("dashboard", id, nextCache);
    }
  }, []);

  const loadHome = useCallback(async (id: string, preferredBoardId?: string | null) => {
    const stored = preferredBoardId === undefined ? readStoredBoardId(id, userId) : preferredBoardId;
    try {
      const cached = await getFeatureSnapshot<DashboardOfflineCache>("dashboard", id);
      if (cached?.data && isDashboardOfflineCache(cached.data)) {
        applyHomeCache(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setUpdatedAt(cached.cachedAt);
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    const qs = new URLSearchParams({ orgId: id, mode: "home" });
    if (stored) qs.set("boardId", stored);
    try {
      const response = await fetch(`/api/dashboards?${qs.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        setMessageKind("error");
        setMessage(
          lastCacheRef.current
            ? (typeof err.error === "string" ? err.error : "Could not refresh Home. Showing the last copy on this device.")
            : (typeof err.error === "string" ? err.error : "Could not load Home."),
        );
        return;
      }
      const data = await response.json();
      const next = dashboardCacheFromHomePayload(data);
      applyHomeCache(next);
      setFromCache(false);
      setCachedAt(null);
      setUpdatedAt(new Date().toISOString());
      setMessage("");
      if (data.active?.id) writeStoredBoardId(id, userId, data.active.id);
      try {
        await putFeatureSnapshot("dashboard", id, next);
      } catch {
        // Live Home already painted; IndexedDB is best-effort.
      }
    } catch {
      if (lastCacheRef.current) {
        setFromCache(true);
        setMessageKind("error");
        setMessage("Could not refresh Home. Showing the last copy on this device.");
      } else {
        setMessageKind("error");
        setMessage("Could not load Home.");
      }
    }
  }, [applyHomeCache, userId]);

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
      const fallback = defaultDashboardLayoutForAudience(homeAudienceFromTeamRole(me.teamRole));
      setLayout(fallback);
      setBoard({
        id: null,
        name: "Default home",
        scope: "personal",
        layout: fallback,
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
        if (
          error instanceof DOMException &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          return;
        }
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
  }, [orgId, loadHome, loadSnapshot, me.teamRole]);

  useEffect(() => {
    document.body.classList.toggle("dash-editing", editing || previewing);
    return () => document.body.classList.remove("dash-editing");
  }, [editing, previewing]);

  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  useEffect(() => {
    widgetsRef.current = widgets;
  }, [widgets]);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

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

  return {
    me,
    board,
    layout,
    widgets,
    context,
    editing,
    previewing,
    libraryOpen,
    pendingPlaceType,
    scope,
    canShareOrg,
    role,
    message,
    messageKind,
    saving,
    updatedAt,
    fromCache,
    cachedAt,
    meLoaded,
    announce,
    grabbedId,
    boards,
    boardsOpen,
    renameId,
    renameDraft,
    orgId,
    userId,
    layoutRef,
    displayRef,
    grabBaseRef,
    shellRef,
    loadHome,
    loadSnapshot,
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
  };
}
