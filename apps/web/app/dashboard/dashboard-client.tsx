"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import PartnerPlacement from "../../components/partner-placement";
import GridLayout, { useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import {
  DEFAULT_DASHBOARD_LAYOUT,
  SECONDARY_WIDGET_TYPES,
  WIDGET_CATALOG,
  canAccessWidget,
  catalogEntry,
  type DashboardWidgetLayout,
  type DashboardWidgetType,
} from "../../lib/dashboard/catalog";
import type { WidgetPayload } from "../../lib/dashboard/snapshot";
import { Icon } from "../../components/app-shell";
import { countdownLabel, DashboardWidgetView } from "./widgets";
import "react-grid-layout/css/styles.css";

type Me = {
  name?: string;
  orgId?: string | null;
  orgName?: string | null;
  teamNumber?: number | null;
  role?: string | null;
  tbaConfigured?: boolean;
};

type BoardState = {
  id: string | null;
  name: string;
  scope: "personal" | "org";
  layout: DashboardWidgetLayout[];
  isDefault?: boolean;
};

const POLL_MS = 30_000;

const WIDGET_PICKER_ICON: Partial<Record<DashboardWidgetType, "swords" | "cube" | "bolt" | "bell" | "grid" | "stats" | "target" | "clipboard" | "gear" | "display" | "chat" | "pin">> = {
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

  const orgId = me.orgId ?? "";

  const loadBoard = useCallback(async (id: string) => {
    const response = await fetch(`/api/dashboards?orgId=${encodeURIComponent(id)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      setMessageKind("error");
      setMessage(err.error ?? "Could not load dashboard");
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
    const data = await response.json();
    setRole(data.role ?? null);
    setCanShareOrg(Boolean(data.canShareOrg));
    setBoard(data.active);
    setScope(data.active?.scope === "org" ? "org" : "personal");
    setLayout(data.active?.layout?.length ? data.active.layout : DEFAULT_DASHBOARD_LAYOUT);
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

  function addWidget(type: DashboardWidgetType) {
    if (layout.some((item) => item.type === type)) {
      setMessageKind("error");
      setMessage("That widget is already on the board.");
      return;
    }
    const entry = catalogEntry(type);
    if (!entry) return;
    const y = layout.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    setLayout((current) => [
      ...current,
      {
        i: `w-${type}-${Date.now()}`,
        type,
        x: 0,
        y,
        w: entry.defaultW,
        h: entry.defaultH,
        minW: entry.minW,
        minH: entry.minH,
      },
    ]);
    setMessage("");
    setLibraryOpen(false);
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
      const response = await fetch("/api/dashboards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          id: board?.id && board.scope === activateScope ? board.id : null,
          name: activateScope === "org" ? "Team dashboard" : "My dashboard",
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
      setLayout(data.layout ?? DEFAULT_DASHBOARD_LAYOUT);
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
  const nextMatchPayload = widgets.next_match;
  const nextMatchData =
    nextMatchPayload?.status === "live" ? (nextMatchPayload.data as Record<string, unknown> | undefined) : undefined;
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

  return (
    <main className={`dash-home${editing ? " is-editing" : ""}`}>
      <header className="dash-home-header">
        <div>
          <span className="breadcrumbs">
            {me.orgName ?? "Workspace"} {me.teamNumber ? `· ${me.teamNumber}` : ""}
            {board && !board.isDefault ? (
              <span className="dash-scope-pill" data-scope={scope}>
                {scope === "org" ? "Team layout" : "Personal layout"}
              </span>
            ) : null}
          </span>
          <h1>
            {greeting()}, {firstName}
          </h1>
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
            <a className="dash-next-glance" href={`/intel${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`}>
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
                  ? `/team/data?orgId=${encodeURIComponent(orgId)}`
                  : `/command?orgId=${encodeURIComponent(orgId)}`
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

      {message ? (
        <p className={`telemetry-status${messageKind === "success" ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      {meLoaded && (!orgId || setupRequired || tbaConfigured === false || !hasScoutingSchemas || !hasAiProvider) ? (
        <section className="dash-setup-banner" aria-label="First-run setup">
          <div>
            <span className="app-badge setup">Setup required</span>
            <h2>
              {!orgId
                ? "Join your team workspace"
                : setupRequired
                  ? "Select an active event"
                  : tbaConfigured === false
                    ? "Connect TBA for live data"
                    : !hasScoutingSchemas
                      ? "Create scouting forms"
                      : !hasAiProvider
                        ? "Configure metered AI"
                        : "Finish setup"}
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
            <li className={orgId ? "done" : "current"}>
              <b>1</b>
              <div>
                <strong>Join workspace</strong>
                <span>Accept a team invite or select your org</span>
              </div>
              {!orgId ? <a href="/invite">Invite</a> : <em>Done</em>}
            </li>
            <li className={!orgId ? undefined : setupRequired ? "current" : "done"}>
              <b>2</b>
              <div>
                <strong>Select event</strong>
                <span>Set the active competition context</span>
              </div>
              {orgId && setupRequired ? (
                <a href={`/command?orgId=${encodeURIComponent(orgId)}`}>Open</a>
              ) : orgId && !setupRequired ? (
                <em>Done</em>
              ) : (
                <span />
              )}
            </li>
            <li className={!orgId ? undefined : tbaConfigured === false ? "current" : tbaConfigured ? "done" : undefined}>
              <b>3</b>
              <div>
                <strong>Sync TBA</strong>
                <span>Match and rank data from The Blue Alliance</span>
              </div>
              {tbaConfigured === false && orgId ? (
                <a href={`/team/data?orgId=${encodeURIComponent(orgId)}`}>Connect</a>
              ) : tbaConfigured ? (
                <em>Ready</em>
              ) : (
                <span />
              )}
            </li>
            <li className={!orgId || setupRequired ? undefined : !hasScoutingSchemas ? "current" : "done"}>
              <b>4</b>
              <div>
                <strong>Scout</strong>
                <span>Starter match and pit forms for the season</span>
              </div>
              {orgId && !setupRequired && !hasScoutingSchemas ? (
                <a href={`/scouting?orgId=${encodeURIComponent(orgId)}`}>Open</a>
              ) : orgId && hasScoutingSchemas ? (
                <em>Ready</em>
              ) : (
                <span />
              )}
            </li>
            <li className={!orgId ? undefined : !hasAiProvider ? "current" : "done"}>
              <b>5</b>
              <div>
                <strong>Metered AI</strong>
                <span>BYO provider key for free-tier AI features</span>
              </div>
              {orgId && !hasAiProvider ? (
                <a href={`/team?orgId=${encodeURIComponent(orgId)}#custom-providers`}>Configure</a>
              ) : orgId && hasAiProvider ? (
                <em>Ready</em>
              ) : (
                <span />
              )}
            </li>
          </ol>
        </section>
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
            <strong>Edit mode</strong>
            <span>
              Widgets jiggle like a Home Screen — drag to rearrange, pinch-resize from the corner, tap − to remove, then
              Done to save
              {orgId
                ? canShareOrg
                  ? " personally or for the team."
                  : " as your personal layout."
                : ". Select a workspace to persist."}
            </span>
          </div>
          <div className="dash-catalog" data-testid="dash-catalog-inline">
            {availableCatalog.map((entry) => {
              const present = layout.some((item) => item.type === entry.type);
              return (
                <button
                  key={entry.type}
                  type="button"
                  disabled={present}
                  title={entry.description}
                  onClick={() => addWidget(entry.type)}
                >
                  {present ? "On board" : "Add"} · {entry.label}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <section
        ref={containerRef}
        className={`dash-grid-wrap${editing ? " editing" : ""}${dragging ? " dragging" : ""}`}
        aria-label="Dashboard widgets"
      >
        {mounted ? (
          layout.length === 0 && editing ? (
            <button type="button" className="dash-empty-board" onClick={() => setLibraryOpen(true)}>
              <span className="dash-empty-board-plus">+</span>
              <strong>Add widgets</strong>
              <span>Pick from the library to build your Home Screen</span>
            </button>
          ) : (
            <GridLayout
              className="dash-grid"
              width={width}
              layout={gridLayout}
              gridConfig={{
                cols: isNarrow ? 1 : 12,
                rowHeight: 56,
                margin: [12, 12],
                containerPadding: [0, 0],
              }}
              dragConfig={{ enabled: editing, handle: ".dash-drag-surface" }}
              resizeConfig={{ enabled: editing }}
              compactor={verticalCompactor}
              onLayoutChange={onLayoutChange}
              onDragStart={() => setDragging(true)}
              onDragStop={() => setDragging(false)}
              onResizeStart={() => setDragging(true)}
              onResizeStop={() => setDragging(false)}
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
                        className="dash-drag-handle dash-drag-surface"
                        aria-label={`Move ${catalogEntry(item.type)?.label ?? item.type}`}
                      >
                        <span className="dash-drag-dots" aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                  <div className={editing ? "dash-drag-surface dash-widget-hit" : "dash-widget-hit"}>
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
    </main>
  );
}
