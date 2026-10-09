"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  readStoredBoardId,
  writeStoredBoardId,
} from "../../lib/dashboard/boards";
import { mergeDashboardContext, mergeDashboardWidgets, snapshotPollWidgetTypes } from "../../lib/dashboard/refresh";
import {
  defaultDashboardLayoutForAudience,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
} from "../../lib/dashboard/catalog";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import type { DashboardShellKind } from "../../lib/dashboard/dashboard-related";
import { homeAudienceFromTeamRole } from "../../lib/home-workflows";
import {
  fetchProductSession,
  invalidateProductSession,
  productSessionUnreachable,
} from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS, persistOrgIdInUrl, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { CONTEXT_REFRESH_MS } from "./dashboard-canvas";
import type { BoardMeta, BoardState, Me } from "./dashboard-board-types";
import { apiErrorMessage } from "../../lib/ui/load-failure";
import {
  dashboardCacheFromHomePayload,
  dashboardCacheAfterSave,
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
  const [scope, setScope] = useState<"personal" | "org">("personal");
  const [canShareOrg, setCanShareOrg] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");
  /** A one-tap follow-up offered with the message — "Undo" after a remove. */
  const [messageAction, setMessageAction] = useState<"undo" | null>(null);
  /** The card just added, so the board can scroll to it and flash it once. */
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [accessStatus, setAccessStatus] = useState<number | null>(null);
  const [loadedScope, setLoadedScope] = useState("");
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  // The account call failed or timed out: unknown, not "no team". Home used to answer a slow
  // /api/me with "Choose your team" and the waitlist card to a team's own owner.
  const [meFailed, setMeFailed] = useState(false);
  const [meAttempt, setMeAttempt] = useState(0);
  const retryMe = useCallback(() => {
    invalidateProductSession();
    setMeFailed(false);
    setMeLoaded(false);
    setMeAttempt((n) => n + 1);
  }, []);
  /*
    The team's real board (mode=home, or the copy saved on this device) has
    arrived. Until then Home is one neutral skeleton: it used to paint the
    built-in "My Home" board and its copy first, and Edit worked on that
    placeholder, so a captain could arrange a board that was not theirs.
  */
  const [boardLoaded, setBoardLoaded] = useState(false);
  /** The first widget data has arrived (or failed), so cards can say what they know. */
  const [widgetsLoaded, setWidgetsLoaded] = useState(false);
  /** ?customize=1 asked for edit mode; it waits for the real board. */
  const [pendingCustomize, setPendingCustomize] = useState(false);
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
  const snapshotSequence = useRef(0);
  const appliedSequence = useRef<Record<string, number>>({});
  const homeSequence = useRef(0);
  const homeRequest = useRef<AbortController | null>(null);
  const activeScope = useRef("");
  activeScope.current = `${userId}:${orgId}`;
  const denied = useRef(false);

  const revokeHome = useCallback((id: string, status: number, reason?: string | null) => {
    denied.current = true;
    lastCacheRef.current = null;
    widgetsRef.current = {}; contextRef.current = {};
    setWidgets({}); setContext({}); setLayout([]); setBoard(null); setBoards([]);
    setRole(null); setCanShareOrg(false); setEditing(false); setPreviewing(false); setLibraryOpen(false);
    setFromCache(false); setCachedAt(null); setUpdatedAt(null);
    setBoardLoaded(true); setWidgetsLoaded(true);
    setMessageKind("error"); setMessageAction(null);
    setAccessStatus(status);
    setMessage(reason || "Your session or team access changed. Sign in again or choose a team you can access.");
    void clearFeatureSnapshot("dashboard", id).catch(() => undefined);
  }, []);

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
    layoutRef.current = next.layout;
    setWidgets(next.widgets);
    setContext(next.context);
    setBoardLoaded(true);
    if (Object.keys(next.widgets).length > 0) setWidgetsLoaded(true);
  }, []);

  const acceptSavedBoard = useCallback(async (saved: BoardState) => {
    if (activeScope.current !== `${userId}:${orgId}` || denied.current) return;
    const previous = lastCacheRef.current;
    if (!previous) throw new Error("Home must finish loading before it can be saved.");
    const next = dashboardCacheAfterSave(previous, saved);
    applyHomeCache(next);
    setFromCache(false);
    setCachedAt(null);
    setUpdatedAt(new Date().toISOString());
    // Optional device storage must not hold the save button after the server acknowledged it.
    void putFeatureSnapshot("dashboard", orgId, next).catch(() => undefined);
  }, [applyHomeCache, orgId, userId]);

  const loadSnapshot = useCallback(async (
    id: string,
    types?: DashboardWidgetType[],
    opts?: { fullContext?: boolean; signal?: AbortSignal },
  ) => {
    const requestScope = activeScope.current;
    if (!id || denied.current || requestScope !== `${userId}:${id}`) return;
    const boardSequence = homeSequence.current;
    const requested = types ?? snapshotPollWidgetTypes(layoutRef.current, { shell: shellRef.current });
    const sequence = ++snapshotSequence.current;
    const qs = new URLSearchParams({ orgId: id, mode: "snapshot" });
    if (requested.length) qs.set("widgets", [...new Set(requested)].join(","));
    if (opts?.fullContext) qs.set("context", "full");
    const timeout = AbortSignal.timeout(FEATURE_API_TIMEOUT_MS);
    const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    const response = await fetch(`/api/dashboards?${qs.toString()}`, { signal, cache: "no-store" });
    if (signal.aborted || activeScope.current !== requestScope || homeSequence.current !== boardSequence) return;
    if (response.status === 401 || response.status === 403) {
      const reason = await apiErrorMessage(response);
      if (activeScope.current !== requestScope || homeSequence.current !== boardSequence || signal.aborted) return;
      revokeHome(id, response.status, reason); throw Object.assign(new Error("Dashboard access changed."), { status: response.status });
    }
    if (!response.ok) throw new Error("Could not refresh dashboard data.");
    const data = await response.json();
    if (signal.aborted || activeScope.current !== requestScope || homeSequence.current !== boardSequence || denied.current) return;
    if (typeof data.role === "string" && lastCacheRef.current && data.role !== lastCacheRef.current.role) {
      revokeHome(id, 403, "Your team role changed. Reopen Home to load the tools available to your new role.");
      throw Object.assign(new Error("Dashboard permissions changed."), { status: 403 });
    }
    // A slow background poll cannot undo a newer refresh after a task was saved.
    const incoming: Record<string, WidgetPayload> = {};
    for (const [key, value] of Object.entries(data.widgets ?? {})) {
      if ((appliedSequence.current[key] ?? 0) > sequence) continue;
      appliedSequence.current[key] = sequence;
      incoming[key] = value as WidgetPayload;
    }
    const nextWidgets = mergeDashboardWidgets(widgetsRef.current, incoming);
    const acceptContext = (appliedSequence.current.context ?? 0) <= sequence;
    if (acceptContext) appliedSequence.current.context = sequence;
    const nextContext = mergeDashboardContext(contextRef.current, acceptContext ? data.context : undefined);
    widgetsRef.current = nextWidgets;
    contextRef.current = nextContext;
    setWidgets(nextWidgets);
    setContext(nextContext);
    setWidgetsLoaded(true);
    setUpdatedAt(new Date().toISOString());
    const prev = lastCacheRef.current;
    if (prev) {
      const nextCache: DashboardOfflineCache = { ...prev, widgets: nextWidgets, context: nextContext };
      lastCacheRef.current = nextCache;
      void putFeatureSnapshot("dashboard", id, nextCache).catch(() => undefined);
    }
  }, [userId, revokeHome]);

  const loadHome = useCallback(async (id: string, preferredBoardId?: string | null) => {
    const requestScope = `${userId}:${id}`;
    if (!userId || activeScope.current !== requestScope) return;
    const sequence = ++homeSequence.current;
    homeRequest.current?.abort();
    const controller = new AbortController();
    homeRequest.current = controller;
    const current = () => !controller.signal.aborted && activeScope.current === requestScope && homeSequence.current === sequence;
    const stored = preferredBoardId === undefined ? readStoredBoardId(id, userId) : preferredBoardId;
    let liveAccepted = false;
    const cacheSequence = snapshotSequence.current;
    // Optional device storage must never delay the live board request.
    void getFeatureSnapshot<DashboardOfflineCache>("dashboard", id).then(cached => {
      if (!current() || liveAccepted || Object.values(appliedSequence.current).some(value => value > cacheSequence)) return;
      if (!denied.current && !lastCacheRef.current && cached?.userId === userId && cached.data && isDashboardOfflineCache(cached.data) && (preferredBoardId === undefined || cached.data.board?.id === preferredBoardId)) {
        applyHomeCache(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setUpdatedAt(cached.cachedAt);
      }
    }).catch(() => undefined);
    if (!current()) return;
    const qs = new URLSearchParams({ orgId: id, mode: "home" });
    if (stored) qs.set("boardId", stored);
    try {
      const response = await fetch(`/api/dashboards?${qs.toString()}`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
      });
      if (!current()) return;
      if (response.status === 401 || response.status === 403) {
        const reason = await apiErrorMessage(response);
        if (current()) revokeHome(id, response.status, reason);
        return false;
      }
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (!current()) return;
        setMessageKind("error");
        setMessage(
          lastCacheRef.current
            ? (typeof err.error === "string" ? err.error : "Could not refresh Home. Showing the last copy on this device.")
            : (typeof err.error === "string" ? err.error : "Could not load Home."),
        );
        setBoardLoaded(true);
        return false;
      }
      const data = await response.json();
      if (!current()) return;
      const next = dashboardCacheFromHomePayload(data);
      liveAccepted = true;
      denied.current = false;
      setAccessStatus(null);
      applyHomeCache(next);
      setFromCache(false);
      setCachedAt(null);
      setUpdatedAt(new Date().toISOString());
      setMessage("");
      if (data.active?.id) writeStoredBoardId(id, userId, data.active.id);
      void putFeatureSnapshot("dashboard", id, next).catch(() => undefined);
      return true;
    } catch {
      if (!current()) return;
      if (lastCacheRef.current) {
        setFromCache(true);
        setMessageKind("error");
        setMessage("Could not refresh Home. Showing the last copy on this device.");
      } else {
        setMessageKind("error");
        setMessage("Could not load Home.");
      }
      setBoardLoaded(true);
      return false;
    } finally {
      if (homeRequest.current === controller) homeRequest.current = null;
    }
  }, [applyHomeCache, userId, revokeHome]);

  useEffect(() => {
    let active = true;
    const fromUrl = readOrgIdFromSearch(window.location.search) ?? initialOrgId;
    void fetchProductSession(fromUrl || null)
      .then((data) => {
        if (!active) return;
        if (!data) {
          // "Not signed in" is an answer; only an unreachable session is "couldn't load".
          setMeFailed(productSessionUnreachable());
          if (!productSessionUnreachable()) setMe({});
          return;
        }
        setMeFailed(false);
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
      .catch(() => { if (active) setMeFailed(true); })
      .finally(() => { if (active) setMeLoaded(true); });
    return () => { active = false; };
  }, [initialOrgId, meAttempt]);

  const loadedScopeRef = useRef<string | null>(null);
  useEffect(() => {
    const nextScope = `${userId}:${orgId}`;
    setLoadedScope(nextScope);
    if (loadedScopeRef.current !== nextScope) {
      setBoardLoaded(false); setWidgetsLoaded(false);
      lastCacheRef.current = null; widgetsRef.current = {}; contextRef.current = {};
      appliedSequence.current = {};
      setWidgets({}); setContext({}); setBoard(null); setBoards([]);
      setEditing(false); setPreviewing(false); setLibraryOpen(false);
      setCanShareOrg(false); setBoardsOpen(false);
      setFromCache(false); setCachedAt(null); setUpdatedAt(null);
      setAccessStatus(null); denied.current = false;
    }
    loadedScopeRef.current = nextScope;
    // Apply the no-team board after clearing the previous account's state.
    if (!orgId && meLoaded && !meFailed) {
      const fallback = defaultDashboardLayoutForAudience(homeAudienceFromTeamRole(me.teamRole));
      setLayout(fallback); layoutRef.current = fallback;
      setBoard({ id: null, name: "Default home", scope: "personal", layout: fallback, isDefault: true });
      setBoardLoaded(true); setWidgetsLoaded(true);
      return;
    }
    if (!orgId || !userId || !meLoaded || meFailed) return;
    let cancelled = false;
    let inFlight: AbortController | null = null;
    let lastFull = 0;
    let lastRefresh = 0;
    denied.current = false;
    setAccessStatus(null);

    const poll = async () => {
      if (cancelled || denied.current || document.visibilityState === "hidden" || inFlight || homeRequest.current) return;
      const controller = new AbortController();
      inFlight = controller;
      const fullContext = Date.now() - lastFull >= CONTEXT_REFRESH_MS;
      try {
        await loadSnapshot(orgId, undefined, { fullContext, signal: controller.signal });
        lastRefresh = Date.now();
        if (fullContext) lastFull = Date.now();
      } catch (error) {
        if (
          error instanceof DOMException &&
          (error.name === "AbortError" || error.name === "TimeoutError")
        ) {
          if (error.name === "TimeoutError") setWidgetsLoaded(true);
          return;
        }
        // A failed first load still ends the wait: cards show their own states.
        setWidgetsLoaded(true);
      } finally {
        if (inFlight === controller) inFlight = null;
      }
    };

    /*
      Load the widget data now, not in thirty seconds.

      `mode=home` returns the board and its layout and no widget data at all;
      the data arrives on the first `poll()`, which used to be scheduled rather
      than run — so for `DASHBOARD_POLL_MS` after opening Home, every widget and
      the "what to do now" card had nothing to read. The card's honest answer to
      "nothing loaded" is "Nothing you have to do right now", so a team with a
      build night at six was told there was nothing to do for the first thirty
      seconds of every visit.

      It looked fine in practice because the offline snapshot in IndexedDB
      usually painted the previous visit's data over the gap. On a phone that
      had never opened Home before — a student's first use, which is the moment
      that matters — there was nothing to paint.

      Home first so the layout is known and one request fetches every widget the
      board actually shows; `poll` is a no-op while another is in flight.
    */
    void loadHome(orgId).finally(() => {
      if (!cancelled) void poll();
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible" && Date.now() - lastRefresh >= 60_000) void poll();
    };
    const onResume = () => {
      lastFull = 0;
      // If returning during an old request, supersede it rather than drop the refresh.
      inFlight?.abort();
      inFlight = null;
      void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onResume);
    window.addEventListener("vantage:dashboard-refresh", onResume);

    return () => {
      cancelled = true;
      inFlight?.abort();
      homeRequest.current?.abort(); homeRequest.current = null;
      homeSequence.current++;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onResume);
      window.removeEventListener("vantage:dashboard-refresh", onResume);
    };
  }, [orgId, userId, meLoaded, meFailed, me.teamRole, loadHome, loadSnapshot]);

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
      // Straight into edit mode with the widget sheet closed: the board is
      // what you came to arrange, and "+ Add widget" is one tap away. Only
      // once the real board is here (the client enters edit mode then).
      setPendingCustomize(true);
      params.delete("customize");
      const next = params.toString();
      const cleaned = `${window.location.pathname}${next ? `?${next}` : ""}${window.location.hash}`;
      // The view brings the board into sight whenever edit mode starts.
      window.history.replaceState({}, "", cleaned);
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
    scope,
    canShareOrg,
    role,
    message,
    messageKind,
    messageAction,
    highlightId,
    saving,
    updatedAt,
    fromCache,
    cachedAt,
    accessStatus,
    scopeReady: loadedScope === `${userId}:${orgId}`,
    meLoaded,
    meFailed,
    retryMe,
    boardLoaded,
    widgetsLoaded,
    pendingCustomize,
    setPendingCustomize,
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
    acceptSavedBoard,
    loadSnapshot,
    setLayout,
    setBoard,
    setBoards,
    setScope,
    setSaving,
    setMessage,
    setMessageKind,
    setMessageAction,
    setHighlightId,
    setAnnounce,
    setGrabbedId,
    setEditing,
    setPreviewing,
    setLibraryOpen,
    setBoardsOpen,
    setRenameId,
    setRenameDraft,
  };
}
