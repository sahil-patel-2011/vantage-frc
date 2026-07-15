"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { DashboardWidgetView } from "./widgets";
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
  const [scope, setScope] = useState<"personal" | "org">("personal");
  const [canShareOrg, setCanShareOrg] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const orgId = me.orgId ?? "";

  const loadBoard = useCallback(async (id: string) => {
    const response = await fetch(`/api/dashboards?orgId=${encodeURIComponent(id)}`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
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
          name: data.name,
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
      .catch(() => undefined);
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
  }

  function removeWidget(id: string) {
    setLayout((current) => current.filter((item) => item.i !== id));
  }

  async function save(activateScope: "personal" | "org" = scope) {
    if (!orgId) {
      setMessage("Select a team workspace to save a custom layout.");
      return;
    }
    if (activateScope === "org" && !canShareOrg) {
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
      setMessage(data.scope === "org" ? "Saved as team dashboard." : "Personal dashboard saved.");
    } finally {
      setSaving(false);
    }
  }

  async function resetDefault() {
    if (!orgId) {
      setLayout(DEFAULT_DASHBOARD_LAYOUT);
      setEditing(false);
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
        setMessage(data.error ?? "Reset failed");
        return;
      }
      setLayout(data.layout ?? DEFAULT_DASHBOARD_LAYOUT);
      setMessage("Reset to default home widgets.");
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const firstName = (me.name ?? "coach").split(" ")[0] || "coach";
  const tbaConfigured = context.tbaConfigured ?? me.tbaConfigured;
  const setupRequired = Boolean(context.setupRequired);
  const gridLayout: Layout = layout.map((item) => ({
    i: item.i,
    x: item.x,
    y: item.y,
    w: item.w,
    h: item.h,
    minW: item.minW ?? 2,
    minH: item.minH ?? 2,
    static: !editing,
  }));

  return (
    <main className="dash-home command-center">
      <header className="dash-home-header">
        <div>
          <span className="breadcrumbs">
            {me.orgName ?? "Workspace"} {me.teamNumber ? `· ${me.teamNumber}` : ""}
          </span>
          <h1>
            {greeting()}, {firstName}
          </h1>
          <p>
            {!orgId
              ? "Select a team workspace to load live command-center data. No fabricated ranks, EPA, or match times are shown."
              : tbaConfigured === false
                ? "TBA not configured — connect The Blue Alliance before expecting live match/rank sync."
                : setupRequired
                  ? "Select an active event (and team number) to load live competition data."
                  : context.eventName
                    ? `${String(context.eventName)} command center`
                    : "Next match, readiness, and alerts — customize when you need more."}
          </p>
        </div>
        <div className="dash-home-actions">
          {updatedAt && orgId ? <small className="dash-updated">Synced · {new Date(updatedAt).toLocaleTimeString()}</small> : null}
          {!orgId ? (
            <a className="app-button secondary" href="/workspace">
              Select workspace
            </a>
          ) : setupRequired || tbaConfigured === false ? (
            <a className="app-button secondary" href={tbaConfigured === false ? "/admin/connectors" : "/workspace"}>
              {tbaConfigured === false ? "Connect TBA" : "Select event"}
            </a>
          ) : null}
          {!editing ? (
            <button
              className="app-button secondary"
              type="button"
              data-testid="dash-customize"
              onClick={() => setEditing(true)}
            >
              Customize
            </button>
          ) : (
            <>
              <button className="app-button secondary" type="button" disabled={saving} onClick={() => void resetDefault()}>
                Reset default
              </button>
              <button className="app-button secondary" type="button" data-testid="dash-preview" onClick={() => setEditing(false)}>
                Preview
              </button>
              <button className="app-button" type="button" disabled={saving} onClick={() => void save("personal")}>
                Save
              </button>
              {canShareOrg ? (
                <button className="app-button secondary" type="button" disabled={saving} onClick={() => void save("org")}>
                  Save for team
                </button>
              ) : null}
            </>
          )}
        </div>
      </header>

      {message ? (
        <p className="telemetry-status" role="status">
          {message}
        </p>
      ) : null}

      {!orgId || setupRequired || tbaConfigured === false ? (
        <section className="dash-setup-banner" aria-label="First-run setup">
          <div>
            <span className="app-badge setup">Setup required</span>
            <h2>
              {!orgId
                ? "Connect your team workspace"
                : tbaConfigured === false
                  ? "Connect TBA for live data"
                  : "Select an active event"}
            </h2>
            <p>
              Live widgets stay empty on purpose until this path is complete. Vantage will not invent ranks, EPA, match
              times, or readiness percentages.
            </p>
          </div>
          <ol className="dash-setup-steps">
            <li className={orgId ? "done" : "current"}>
              <b>1</b>
              <div>
                <strong>Select workspace</strong>
                <span>Choose your team organization</span>
              </div>
              {!orgId ? <a href="/workspace">Open</a> : <em>Done</em>}
            </li>
            <li className={!orgId ? undefined : setupRequired ? "current" : "done"}>
              <b>2</b>
              <div>
                <strong>Select event / location</strong>
                <span>Set the active competition context</span>
              </div>
              {orgId && setupRequired ? <a href="/workspace">Open</a> : orgId && !setupRequired ? <em>Done</em> : <span />}
            </li>
            <li className={tbaConfigured === false ? "current" : tbaConfigured ? "done" : undefined}>
              <b>3</b>
              <div>
                <strong>Sync TBA</strong>
                <span>Platform TBA key powers match and rank ingest</span>
              </div>
              {tbaConfigured === false ? (
                <a href="/admin/connectors">Connect</a>
              ) : tbaConfigured ? (
                <em>Ready</em>
              ) : (
                <span />
              )}
            </li>
          </ol>
        </section>
      ) : null}

      {editing ? (
        <section
          className="dash-editor-bar"
          role="region"
          aria-label="Widget catalog"
        >
          <div className="dash-editor-copy">
            <strong>Edit mode</strong>
            <span>Drag to rearrange, resize from the corner, add or remove widgets, then save.</span>
          </div>
          <div className="dash-catalog">
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
        className={`dash-grid-wrap${editing ? " editing" : ""}`}
        aria-label="Dashboard widgets"
      >
        {mounted ? (
          <GridLayout
            className="dash-grid"
            width={width}
            layout={gridLayout}
            gridConfig={{
              cols: 12,
              rowHeight: 56,
              margin: [14, 14],
              containerPadding: [0, 0],
            }}
            dragConfig={{ enabled: editing, handle: ".dash-drag-handle" }}
            resizeConfig={{ enabled: editing }}
            compactor={verticalCompactor}
            onLayoutChange={onLayoutChange}
          >
            {layout.map((item) => (
              <div key={item.i} className="dash-grid-item">
                {editing ? (
                  <div className="dash-item-tools">
                    <button type="button" className="dash-drag-handle" aria-label={`Move ${item.type}`}>
                      ⠿
                    </button>
                    <button type="button" aria-label={`Remove ${item.type}`} onClick={() => removeWidget(item.i)}>
                      ×
                    </button>
                  </div>
                ) : null}
                <DashboardWidgetView
                  type={item.type}
                  payload={widgets[item.type]}
                  orgId={orgId}
                  tbaConfigured={tbaConfigured}
                />
              </div>
            ))}
          </GridLayout>
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
    </main>
  );
}
