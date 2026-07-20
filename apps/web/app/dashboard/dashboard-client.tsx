"use client";

import { useCallback, useEffect, useMemo, useState, type DragEvent as ReactDragEvent } from "react";
import PartnerPlacement from "../../components/partner-placement";
import GridLayout, { useContainerWidth, verticalCompactor, type Layout, type LayoutItem } from "react-grid-layout";
import {
  DASHBOARD_COLUMNS,
  DEFAULT_DASHBOARD_LAYOUT,
  SECONDARY_WIDGET_TYPES,
  WIDGET_CATALOG,
  canAccessWidget,
  catalogEntry,
  findDashboardSlot,
  packDashboardLayout,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
} from "../../lib/dashboard/catalog";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import {
  classifyDashboardShell,
  dashboardHubLinks,
  dashboardNextActions,
  dashboardSetupSteps,
  dashboardSetupTitle,
} from "../../lib/dashboard/dashboard-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { Icon } from "../../components/app-shell";
import { DataSourceDegradedBanner } from "../../components/data-source-degraded-banner";
import type { DataSourceHealthView } from "../../lib/reference-health";
import { countdownLabel, DashboardWidgetView } from "./widgets";
import type { HomeStripItem } from "../../lib/home-workflows";
import { Badge } from "../../components/ui";
import "react-grid-layout/css/styles.css";
import "./dashboard-editor.css";
import "./dashboard-dnd.css";

type Me = {
  name?: string;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  teamRole?: string | null;
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

function boardStorageKey(orgId: string) {
  return `vantage.dashboard.board.${orgId}`;
}

function readStoredBoardId(orgId: string) {
  try {
    return window.localStorage.getItem(boardStorageKey(orgId));
  } catch {
    return null;
  }
}

function writeStoredBoardId(orgId: string, boardId: string | null) {
  try {
    if (!boardId) window.localStorage.removeItem(boardStorageKey(orgId));
    else window.localStorage.setItem(boardStorageKey(orgId), boardId);
  } catch {
    /* ignore quota / private mode */
  }
}

type SnapFeedback = {
  mode: "Moving" | "Resizing";
  x: number;
  y: number;
  w: number;
  h: number;
};

const POLL_MS = 30_000;

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

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardClient() {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 960 });
  const [me, setMe] = useState<Me>({});
  const [board, setBoard] = useState<BoardState | null>(null);
  const [layout, setLayout] = useState<DashboardWidgetLayout[]>(DEFAULT_DASHBOARD_LAYOUT);
  const [widgets, setWidgets] = useState<Record<string, WidgetPayload>>({});
  const [context, setContext] = useState<Record<string, unknown>>({});
  const [editing, setEditing] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [scope, setScope] = useState<"personal" | "org">("personal");
  const [canShareOrg, setCanShareOrg] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<"success" | "error">("error");
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [externalWidget, setExternalWidget] = useState<DashboardWidgetType | null>(null);
  const [snapFeedback, setSnapFeedback] = useState<SnapFeedback | null>(null);
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const orgId = me.orgId ?? "";

  const loadBoard = useCallback(async (id: string, preferredBoardId?: string | null) => {
    const stored = preferredBoardId === undefined ? readStoredBoardId(id) : preferredBoardId;
    const qs = new URLSearchParams({ orgId: id });
    if (stored) qs.set("boardId", stored);
    const response = await fetch(`/api/dashboards?${qs.toString()}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setMessageKind("error");
      setMessage(err.error ?? "Could not load dashboard");
      setLayout(DEFAULT_DASHBOARD_LAYOUT);
      setBoards([]);
      setBoard({
        id: null,
        name: "Default home",
        scope: "personal",
        layout: DEFAULT_DASHBOARD_LAYOUT,
        isDefault: true,
      });
      return;
    }
    const data = await response.json();
    setRole(data.role ?? null);
    setCanShareOrg(Boolean(data.canShareOrg));
    setBoards(Array.isArray(data.boards) ? data.boards : []);
    setBoard(data.active);
    setScope(data.active?.scope === "org" ? "org" : "personal");
    setLayout(data.active?.layout?.length ? data.active.layout : DEFAULT_DASHBOARD_LAYOUT);
    if (data.active?.id) writeStoredBoardId(id, data.active.id);
  }, []);

  const loadSnapshot = useCallback(async (id: string) => {
    const response = await fetch(`/api/dashboards?orgId=${encodeURIComponent(id)}&mode=snapshot`);
    if (!response.ok) return;
    const data = await response.json();
    setWidgets(data.widgets ?? {});
    setContext(data.context ?? {});
    setUpdatedAt(new Date().toISOString());
  }, []);

  useEffect(() => {
    void fetch("/api/me")
      .then(async (response) => (response.ok ? await response.json() : null))
      .then((data) => {
        if (!data) return;
        setMe({
          name: data.firstName || data.name,
          orgId: data.orgId,
          orgName: data.orgName,
          teamNumber: data.teamNumber,
          role: data.role,
          tbaConfigured: data.tbaConfigured,
        });
        setRole(data.role ?? null);
        if (typeof data.tbaConfigured === "boolean") {
          setContext((current) => ({ ...current, tbaConfigured: data.tbaConfigured }));
        }
      })
      .catch(() => undefined)
      .finally(() => setMeLoaded(true));
  }, []);

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
    void loadBoard(orgId);
    void loadSnapshot(orgId);
    const timer = window.setInterval(() => void loadSnapshot(orgId), POLL_MS);
    return () => window.clearInterval(timer);
  }, [orgId, loadBoard, loadSnapshot]);

  useEffect(() => {
    document.body.classList.toggle("dash-editing", editing);
    return () => document.body.classList.remove("dash-editing");
  }, [editing]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("customize") === "1") {
      setEditing(true);
      setLibraryOpen(true);
    }
  }, []);

  const availableCatalog = useMemo(
    () => WIDGET_CATALOG.filter((entry) => canAccessWidget(entry.type, role)),
    [role],
  );

  const secondaryTypes = useMemo(
    () =>
      SECONDARY_WIDGET_TYPES.filter(
        (type) => canAccessWidget(type, role) && !layout.some((item) => item.type === type),
      ),
    [layout, role],
  );

  const addableCatalog = useMemo(
    () => availableCatalog.filter((entry) => !layout.some((item) => item.type === entry.type)),
    [availableCatalog, layout],
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

  function onLayoutChange(next: Layout) {
    if (!editing) return;
    setLayout((current) =>
      current.map((item) => {
        const match = next.find((row) => row.i === item.i);
        if (!match) return item;
        return { ...item, x: match.x, y: match.y, w: match.w, h: match.h };
      }),
    );
  }

  function addWidget(type: DashboardWidgetType, drop?: Pick<LayoutItem, "x" | "y">) {
    if (layout.some((item) => item.type === type)) {
      setMessageKind("error");
      setMessage("That widget is already on the board.");
      return;
    }
    const entry = catalogEntry(type);
    if (!entry) return;
    const position = drop ?? findDashboardSlot(layout, entry.defaultW, entry.defaultH);
    setLayout((current) => [
      ...current,
      {
        i: `w-${type}-${Date.now()}`,
        type,
        x: Math.max(0, Math.min(DASHBOARD_COLUMNS - entry.defaultW, position.x)),
        y: Math.max(0, position.y),
        w: entry.defaultW,
        h: entry.defaultH,
        minW: entry.minW,
        minH: entry.minH,
      },
    ]);
    setMessageKind("success");
    setMessage(`${entry.label} snapped onto the dashboard.`);
    setLibraryOpen(false);
  }

  function beginPaletteDrag(event: ReactDragEvent<HTMLButtonElement>, type: DashboardWidgetType) {
    const entry = catalogEntry(type);
    if (!entry) return;
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/vnd.vantage.dashboard-widget", type);
    event.dataTransfer.setData("text/plain", type);
    setExternalWidget(type);
    setMessage("");
  }

  function finishPaletteDrag() {
    setExternalWidget(null);
    setSnapFeedback(null);
  }

  function dropPaletteWidget(_next: Layout, item: LayoutItem | undefined, event: Event) {
    const transferred =
      event instanceof DragEvent
        ? event.dataTransfer?.getData("application/vnd.vantage.dashboard-widget")
        : "";
    const type = externalWidget ?? (transferred as DashboardWidgetType | "");
    if (type && availableCatalog.some((entry) => entry.type === type)) {
      addWidget(type, item ? { x: item.x, y: item.y } : undefined);
    }
    finishPaletteDrag();
  }

  function updateSnap(mode: SnapFeedback["mode"], item: LayoutItem | null) {
    if (!item) return;
    setSnapFeedback({ mode, x: item.x, y: item.y, w: item.w, h: item.h });
  }

  function tidyLayout() {
    setLayout((current) => packDashboardLayout(current));
    setMessageKind("success");
    setMessage("Widgets snapped upward into a clean, collision-free layout.");
  }

  function cycleWidgetSize(id: string) {
    setLayout((current) => {
      const resized = current.map((item) => {
        if (item.i !== id) return item;
        const entry = catalogEntry(item.type);
        if (!entry) return item;
        const atCompact = item.w === entry.minW && item.h === entry.minH;
        const atDefault = item.w === entry.defaultW && item.h === entry.defaultH;
        if (atCompact) return { ...item, w: entry.defaultW, h: entry.defaultH };
        if (atDefault) return { ...item, w: DASHBOARD_COLUMNS, h: Math.max(entry.defaultH, entry.minH) };
        return { ...item, w: entry.minW, h: entry.minH };
      });
      return packDashboardLayout(resized);
    });
  }

  function removeWidget(id: string) {
    setLayout((current) => current.filter((item) => item.i !== id));
  }

  async function save(activateScope: "personal" | "org" = scope) {
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
      writeStoredBoardId(orgId, data.id);
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
      setMessageKind("success");
      setMessage(data.scope === "org" ? "Saved as team Home Screen." : "Personal Home Screen saved.");
      await loadBoard(orgId, data.id);
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
      writeStoredBoardId(orgId, data.id);
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
      await loadBoard(orgId, data.id);
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
      writeStoredBoardId(orgId, data.id);
      setEditing(true);
      setBoardsOpen(false);
      setMessageKind("success");
      setMessage(`Created ${data.name}. Arrange widgets, then Done.`);
      await loadBoard(orgId, data.id);
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
      if (board?.id === targetId) writeStoredBoardId(orgId, data.activatedId ?? null);
      setRenameId(null);
      setMessageKind("success");
      setMessage(`Deleted ${target.name}`);
      await loadBoard(orgId, data.activatedId ?? null);
    } finally {
      setSaving(false);
    }
  }

  function cancelEditing() {
    setLayout(board?.layout ?? DEFAULT_DASHBOARD_LAYOUT);
    setEditing(false);
    setLibraryOpen(false);
    setMessage("");
  }

  function enterEditMode() {
    setEditing(true);
    setLibraryOpen(false);
    setMessage("");
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
      const nextLayout = data.layout ?? DEFAULT_DASHBOARD_LAYOUT;
      setLayout(nextLayout);
      setBoard((current) => (current ? { ...current, layout: nextLayout } : current));
      setMessageKind("success");
      setMessage("Reset to default home widgets.");
      setEditing(false);
      setLibraryOpen(false);
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
  const homeStripItems = Array.isArray(homeStripRaw?.items) ? homeStripRaw.items : [];
  const homeAudience =
    homeStripRaw?.audience === "mentor" || homeStripRaw?.audience === "student"
      ? homeStripRaw.audience
      : null;
  const nextMatchPayload = widgets.next_match;
  const nextMatchData =
    nextMatchPayload?.status === "live" ? (nextMatchPayload.data as Record<string, unknown> | undefined) : undefined;
  const dashShell = classifyDashboardShell({
    loaded: meLoaded,
    orgId: orgId || null,
    setupRequired,
    tbaConfigured,
  });
  const hubLinks = dashboardHubLinks(orgId || null);
  const nextActions = dashboardNextActions({
    orgId: orgId || null,
    shell: dashShell,
    hasScoutingSchemas,
    hasAiProvider,
  });
  const setupSteps = dashboardSetupSteps({
    orgId: orgId || null,
    setupRequired,
    tbaConfigured,
    hasScoutingSchemas,
    hasAiProvider,
  });
  const isNarrow = mounted && width < 640;
  const gridLayout: Layout = layout.map((item, index) => ({
    i: item.i,
    x: isNarrow ? 0 : item.x,
    y: isNarrow ? index : item.y,
    w: isNarrow ? 1 : item.w,
    h: item.h,
    minW: isNarrow ? 1 : (item.minW ?? 2),
    minH: item.minH ?? 2,
    static: !editing,
  }));
  const externalCatalogEntry = externalWidget ? catalogEntry(externalWidget) : null;
  const droppingItem: LayoutItem | undefined = externalCatalogEntry
    ? {
        i: "__vantage_widget_drop__",
        x: 0,
        y: 0,
        w: isNarrow ? 1 : externalCatalogEntry.defaultW,
        h: externalCatalogEntry.defaultH,
        minW: isNarrow ? 1 : externalCatalogEntry.minW,
        minH: externalCatalogEntry.minH,
      }
    : undefined;
  const canvasWidth = editing ? Math.max(1, width - 20) : width;

  return (
    <main className={`dash-home${editing ? " is-editing" : ""}`}>
      <header className="dash-home-header">
        <div>
          <span className="breadcrumbs">
            {me.orgName ?? "Workspace"} {me.teamNumber ? `· ${me.teamNumber}` : ""}
            {board ? (
              <span className="dash-scope-pill" data-scope={scope}>
                {board.isDefault ? "Default" : scope === "org" ? "Team board" : "Personal board"}
              </span>
            ) : null}
          </span>
          <h1>
            {greeting()}, {firstName}
          </h1>
          {orgId && board ? (
            <p className="dash-board-current">
              <strong>{board.name}</strong>
              <span>{boards.length ? `${boards.length} board${boards.length === 1 ? "" : "s"}` : "Home Screen"}</span>
            </p>
          ) : null}
          <p>
            {!meLoaded
              ? "Loading your workspace…"
              : !orgId
                ? "Select a team workspace to load live command-center data. No fabricated ranks, EPA, or match times are shown."
                : tbaConfigured === false
                  ? "TBA not configured — connect The Blue Alliance before expecting live match/rank sync."
                  : setupRequired
                    ? "Select an active event (and team number) to load live competition data."
                    : context.eventName
                      ? `${String(context.eventName)} — rearrange widgets like a Home Screen.`
                      : "Next match, readiness, and alerts — Edit Home Screen to rearrange or add widgets."}
          </p>
        </div>
        <div className="dash-home-actions">
          {nextMatchData && !editing ? (
            <a className="dash-next-glance" href={withOrgHref("/intel", orgId || null)}>
              <span>Next</span>
              <strong>
                {String(nextMatchData.compLevel ?? "Match").toUpperCase()} {String(nextMatchData.matchNumber ?? "")}
              </strong>
              <b>{countdownLabel(nextMatchData.scheduledTime as string | undefined)}</b>
            </a>
          ) : null}
          {updatedAt && orgId && !editing ? (
            <small className="dash-updated">Synced · {new Date(updatedAt).toLocaleTimeString()}</small>
          ) : null}
          {!orgId ? (
            <a className="app-button secondary" href="/workspace">
              Select workspace
            </a>
          ) : setupRequired || tbaConfigured === false ? (
            <a
              className="app-button secondary"
              href={
                tbaConfigured === false
                  ? withOrgHref("/team/data", orgId)
                  : hubHref("/competition", "command", orgId)
              }
            >
              {tbaConfigured === false ? "Connect TBA" : "Select event"}
            </a>
          ) : null}
          {!editing ? (
            <button
              className="app-button dash-edit-trigger"
              type="button"
              data-testid="dash-customize"
              onClick={enterEditMode}
            >
              Edit Home Screen
            </button>
          ) : null}
        </div>
      </header>

      {orgId && !editing && homeStripItems.length > 0 ? (
        <section
          className="dash-role-strip"
          data-audience={homeAudience ?? "student"}
          aria-label={homeAudience === "mentor" ? "Mentor focus" : "Student focus"}
        >
          <header className="dash-role-strip-head">
            <span>{homeAudience === "mentor" ? "Mentor focus" : "Student focus"}</span>
            <a
              href={
                homeAudience === "mentor"
                  ? withOrgHref("/logistics", orgId)
                  : withOrgHref("/logistics", orgId)
              }
            >
              {homeAudience === "mentor" ? "Hotels & travel" : "My hotel & leave times"}
            </a>
          </header>
          <ul>
            {homeStripItems.map((item) => (
              <li key={item.key} data-tone={item.tone}>
                <a href={item.href}>
                  <span>{item.label}</span>
                  <strong>{item.detail}</strong>
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

      {orgId && meLoaded ? (
        <div className="dash-board-bar" role="navigation" aria-label="Dashboard boards">
          <div className="dash-board-switcher" data-testid="dash-board-switcher">
            {switcherBoards.length === 0 ? (
              <button type="button" aria-pressed={true} disabled>
                Default home
              </button>
            ) : (
              switcherBoards.map((item) => (
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
              ))
            )}
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
          {switcherBoards.length > 1 ? (
            <div className="dash-board-dots" aria-hidden="true">
              {switcherBoards.map((item) => (
                <button
                  key={`dot-${item.id}`}
                  type="button"
                  aria-current={board?.id === item.id ? "true" : undefined}
                  disabled={saving || editing}
                  onClick={() => void switchBoard(item.id)}
                />
              ))}
            </div>
          ) : null}
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

      {meLoaded ? (
        <nav className="dash-hub-rail" aria-label="Product hubs">
          {hubLinks.map((link) => (
            <a key={link.id} href={link.href}>
              {link.label}
            </a>
          ))}
        </nav>
      ) : null}

      {meLoaded && (dashShell !== "ready" || !hasScoutingSchemas || !hasAiProvider) ? (
        <section className="dash-setup-banner" aria-label="First-run setup">
          <div>
            <Badge tone="setup">Setup required</Badge>
            <h2>
              {dashShell !== "ready"
                ? dashboardSetupTitle(dashShell)
                : !hasScoutingSchemas
                  ? "Create scouting forms"
                  : "Configure metered AI"}
            </h2>
            <p>
              Live widgets stay empty on purpose until this path is complete. Vantage will not invent ranks, EPA, match
              times, or readiness percentages.
            </p>
            <p className="dash-setup-note">
              You can rearrange the board anytime — saving layouts requires a workspace.
            </p>
          </div>
          <ol className="dash-setup-steps">
            {setupSteps.map((step, index) => (
              <li key={step.id} className={step.state === "pending" ? undefined : step.state}>
                <b>{index + 1}</b>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                {step.state === "done" ? (
                  <em>{step.id === "tba" || step.id === "scout" || step.id === "ai" ? "Ready" : "Done"}</em>
                ) : step.state === "current" ? (
                  <a href={step.href}>
                    {step.id === "workspace" && !orgId ? "Invite" : step.id === "tba" ? "Connect" : "Open"}
                  </a>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {meLoaded && nextActions.length > 0 ? (
        <section
          className="dash-next-actions app-card soft-panel edc-next-actions"
          aria-label={dashShell === "ready" ? "Explore hubs" : "Next actions"}
        >
          <header>
            <h2>{dashShell === "ready" ? "Explore hubs" : "Next actions"}</h2>
            <p>
              {dashShell === "ready"
                ? "Jump into the Soft-UI pillars — live numbers only appear when your workspace has real data."
                : "Honest handoffs into Competition, Team, Business, Build, and AI — never DEMO metrics."}
            </p>
          </header>
          <ol>
            {nextActions.slice(0, 5).map((action) => (
              <li key={action.id} className={action.primary ? "primary" : undefined}>
                <div>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </div>
                <a className="app-button secondary" href={action.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {meLoaded && orgId && tbaConfigured !== false ? (
        <DataSourceDegradedBanner health={dataSourceHealth} />
      ) : null}

      {meLoaded && (!orgId || setupRequired) && !editing ? (
        <ul className="dash-waiting-strip" aria-label="Widget status">
          <li>Next match · waiting</li>
          <li>Robot readiness · waiting</li>
          <li>No fabricated stats</li>
        </ul>
      ) : null}

      {editing ? (
        <section className="dash-editor-bar" role="region" aria-label="Widget catalog">
          <div className="dash-editor-copy">
            <strong>Build your command center</strong>
            <span>
              Drag a widget below straight onto the canvas, move cards by their grip, or resize from either bottom corner.
              Every move snaps to the 12-column grid
              {orgId
                ? canShareOrg
                  ? " personally or for the team."
                  : " as your personal layout."
                : ". Select a workspace to persist."}
            </span>
          </div>
          <div className="dash-palette-heading">
            <span>Drag to place</span>
            <small>{layout.length} on canvas · {addableCatalog.length} available</small>
          </div>
          <div className="dash-widget-palette" data-testid="dash-catalog-inline">
            {addableCatalog.map((entry) => {
              const icon = WIDGET_PICKER_ICON[entry.type] ?? "grid";
              return (
                <button
                  className={externalWidget === entry.type ? "dragging" : ""}
                  draggable={!isNarrow}
                  key={entry.type}
                  type="button"
                  title={`${entry.description}. Drag onto the board or click to add.`}
                  onClick={() => addWidget(entry.type)}
                  onDragStart={(event) => beginPaletteDrag(event, entry.type)}
                  onDragEnd={finishPaletteDrag}
                >
                  <i><Icon name={icon} /></i>
                  <span><strong>{entry.label}</strong><small>{entry.description}</small></span>
                  <em>{entry.defaultW} × {entry.defaultH}</em>
                </button>
              );
            })}
            {addableCatalog.length === 0 ? <p>Every available widget is already on the canvas.</p> : null}
          </div>
        </section>
      ) : null}

      <section
        ref={containerRef}
        className={`dash-grid-wrap${editing ? " editing" : ""}${dragging ? " dragging" : ""}${externalWidget ? " receiving-widget" : ""}`}
        aria-label="Dashboard widgets"
      >
        {editing ? <div className="dash-grid-guide"><span>12-column snap grid</span><small>Drag by grip · resize from corners</small></div> : null}
        {snapFeedback ? (
          <output className="dash-snap-hud" aria-live="polite">
            <strong>{snapFeedback.mode}</strong>
            <span>columns {snapFeedback.x + 1}–{snapFeedback.x + snapFeedback.w}</span>
            <span>row {snapFeedback.y + 1}</span>
            <b>{snapFeedback.w} × {snapFeedback.h}</b>
          </output>
        ) : externalCatalogEntry ? (
          <div className="dash-drop-coach" aria-live="polite">
            Release <strong>{externalCatalogEntry.label}</strong> on the highlighted snap cells
          </div>
        ) : null}
        {mounted ? (
          layout.length === 0 && editing && !externalWidget ? (
            <button type="button" className="dash-empty-board" onClick={() => setLibraryOpen(true)}>
              <span className="dash-empty-board-plus">+</span>
              <strong>Add widgets</strong>
              <span>Pick from the library to build your Home Screen</span>
            </button>
          ) : (
            <GridLayout
              className="dash-grid"
              width={canvasWidth}
              layout={gridLayout}
              gridConfig={{
                cols: isNarrow ? 1 : DASHBOARD_COLUMNS,
                rowHeight: 56,
                margin: [12, 12],
                containerPadding: [0, 0],
              }}
              dragConfig={{ enabled: editing, bounded: true, handle: ".dash-drag-handle", threshold: 4 }}
              resizeConfig={{ enabled: editing, handles: ["se", "sw"] }}
              dropConfig={{
                enabled: editing,
                defaultItem: {
                  w: droppingItem?.w ?? (isNarrow ? 1 : 4),
                  h: droppingItem?.h ?? 3,
                },
              }}
              droppingItem={droppingItem}
              compactor={verticalCompactor}
              onLayoutChange={onLayoutChange}
              onDropDragOver={() => externalCatalogEntry ? {
                w: isNarrow ? 1 : externalCatalogEntry.defaultW,
                h: externalCatalogEntry.defaultH,
              } : false}
              onDrop={dropPaletteWidget}
              onDragStart={(_next, _old, item) => { setDragging(true); updateSnap("Moving", item); }}
              onDrag={(_next, _old, item) => updateSnap("Moving", item)}
              onDragStop={() => { setDragging(false); setSnapFeedback(null); }}
              onResizeStart={(_next, _old, item) => { setDragging(true); updateSnap("Resizing", item); }}
              onResize={(_next, _old, item) => updateSnap("Resizing", item)}
              onResizeStop={() => { setDragging(false); setSnapFeedback(null); }}
            >
              {layout.map((item) => (
                <div key={item.i} className={`dash-grid-item${editing ? " jiggling" : ""}`}>
                  {editing ? (
                    <div className="dash-item-tools">
                      <button
                        type="button"
                        className="dash-remove-btn"
                        aria-label={`Remove ${catalogEntry(item.type)?.label ?? item.type}`}
                        onClick={() => removeWidget(item.i)}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        className="dash-size-btn"
                        title="Cycle compact, default, and full-width sizes"
                        aria-label={`Change size of ${catalogEntry(item.type)?.label ?? item.type}`}
                        onClick={() => cycleWidgetSize(item.i)}
                      >
                        {item.w} × {item.h}
                      </button>
                      <button
                        type="button"
                        className="dash-drag-handle dash-drag-surface"
                        aria-label={`Move ${catalogEntry(item.type)?.label ?? item.type}`}
                      >
                        <span className="dash-drag-dots" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                  <div className="dash-widget-hit">
                    <DashboardWidgetView
                      type={item.type}
                      payload={widgets[item.type]}
                      orgId={orgId}
                      tbaConfigured={tbaConfigured}
                    />
                  </div>
                </div>
              ))}
            </GridLayout>
          )
        ) : (
          <div className="dash-more-grid">
            {layout.slice(0, 5).map((item) => (
              <DashboardWidgetView
                key={item.i}
                type={item.type}
                payload={widgets[item.type]}
                orgId={orgId}
                tbaConfigured={tbaConfigured}
              />
            ))}
          </div>
        )}
      </section>

      {!editing && secondaryTypes.length > 0 ? (
        <section className="dash-more">
          <button
            type="button"
            className="dash-more-toggle"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
          >
            {moreOpen ? "Hide secondary metrics" : "Show secondary metrics"}
          </button>
          {moreOpen ? (
            <div className="dash-more-grid">
              {secondaryTypes.map((type) => (
                <DashboardWidgetView
                  key={type}
                  type={type}
                  payload={widgets[type]}
                  orgId={orgId}
                  tbaConfigured={tbaConfigured}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {editing ? (
        <div className="dash-edit-dock" role="toolbar" aria-label="Home Screen edit actions">
          <button className="dash-dock-ghost" type="button" disabled={saving} onClick={cancelEditing}>
            Cancel
          </button>
          <button className="dash-dock-ghost" type="button" disabled={saving} onClick={() => void resetDefault()}>
            Reset
          </button>
          <button className="dash-dock-ghost dash-dock-tidy" type="button" disabled={saving} onClick={tidyLayout}>
            <span aria-hidden="true">⌗</span> Snap &amp; tidy
          </button>
          <button
            className="dash-dock-add"
            type="button"
            data-testid="dash-open-library"
            aria-pressed={libraryOpen}
            onClick={() => setLibraryOpen((open) => !open)}
          >
            <span aria-hidden="true">+</span>
            Widgets
          </button>
          <button
            className="dash-dock-ghost"
            type="button"
            data-testid="dash-preview"
            onClick={() => {
              setEditing(false);
              setLibraryOpen(false);
            }}
          >
            Preview
          </button>
          <button className="dash-dock-done" type="button" disabled={saving} onClick={() => void save("personal")}>
            {saving ? "Saving…" : "Done"}
          </button>
          {canShareOrg ? (
            <button className="dash-dock-team" type="button" disabled={saving} onClick={() => void save("org")}>
              Save for team
            </button>
          ) : null}
        </div>
      ) : null}

      {!editing && orgId ? <PartnerPlacement orgId={orgId} surface="dashboard_footer" title="Partners powering this season" /> : null}

      {editing && libraryOpen ? (
        <>
          <button className="dash-library-scrim" type="button" aria-label="Close widget library" onClick={() => setLibraryOpen(false)} />
          <aside className="dash-library-sheet" role="dialog" aria-modal="true" aria-labelledby="dash-library-title">
            <header>
              <div>
                <h2 id="dash-library-title">Widget library</h2>
                <p>Add one of each type. Drag widgets on the grid after placing them.</p>
              </div>
              <button type="button" className="soft-icon-btn" aria-label="Close" onClick={() => setLibraryOpen(false)}>
                <Icon name="x" />
              </button>
            </header>
            {addableCatalog.length === 0 ? (
              <p className="dash-library-empty">Every available widget is already on your Home Screen.</p>
            ) : (
              <ul className="dash-library-grid">
                {addableCatalog.map((entry) => {
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
              <p>Already on board</p>
              <div className="dash-catalog">
                {availableCatalog
                  .filter((entry) => layout.some((item) => item.type === entry.type))
                  .map((entry) => (
                    <button key={entry.type} type="button" disabled>
                      On board · {entry.label}
                    </button>
                  ))}
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {boardsOpen ? (
        <>
          <button
            className="dash-library-scrim"
            type="button"
            aria-label="Close board manager"
            onClick={() => {
              setBoardsOpen(false);
              setRenameId(null);
            }}
          />
          <aside className="dash-boards-sheet" role="dialog" aria-modal="true" aria-labelledby="dash-boards-title">
            <header>
              <div>
                <h2 id="dash-boards-title">Home Screens</h2>
                <p>Personal boards are yours. Team boards are shared — owner/admin can create and edit them.</p>
              </div>
              <button
                type="button"
                className="soft-icon-btn"
                aria-label="Close"
                onClick={() => {
                  setBoardsOpen(false);
                  setRenameId(null);
                }}
              >
                <Icon name="x" />
              </button>
            </header>

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
                              <button type="button" className="danger" disabled={saving} onClick={() => void deleteBoard(item.id)}>
                                Delete
                              </button>
                            </>
                          )
                        ) : (
                          <button type="button" disabled={saving || editing} onClick={() => void switchBoard(item.id)}>
                            Open
                          </button>
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
          </aside>
        </>
      ) : null}
    </main>
  );
}
