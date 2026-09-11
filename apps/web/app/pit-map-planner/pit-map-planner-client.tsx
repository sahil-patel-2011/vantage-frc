"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { venueShapeLabel, type NexusVenueMapView } from "../../lib/display";
import { pitMapCategoryLabel, PIT_MAP_CATEGORIES } from "../../lib/pit-map-planner";
import type { PitMapPlannerView } from "../../lib/pit-map-planner/compute-pit-map-planner";
import type { PitMapItemCategory } from "../../lib/pit-map-planner/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";

function isPitMapPlannerView(value: unknown): value is PitMapPlannerView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistPitMapSnapshot(
  orgHint: string,
  seasonHint: string,
  data: PitMapPlannerView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("pit-map", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("pit-map", "_", data, seasonHint || seasonKey);
  } catch {
    // Live pit map already painted; IndexedDB is best-effort.
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<PitMapPlannerView, { status: "live" }>;

export default function PitMapPlannerClient() {
  const [view, setView] = useState<PitMapPlannerView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<PitMapPlannerView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      const seasonQuery =
        seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
      const seasonHint =
        seasonQuery != null && Number.isFinite(seasonQuery) ? String(seasonQuery) : "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<PitMapPlannerView>(
          "pit-map",
          urlOrg || "_",
          seasonHint,
        );
        if (!viewRef.current && cached?.data && isPitMapPlannerView(cached.data)) {
          setView(cached.data);
          setSeason(cached.data.seasonYear);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setErrorStatus(null);
      setLoadError("");
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonHint) query.set("season", seasonHint);
      try {
        const response = await fetch(
          `/api/pit-map-planner${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as PitMapPlannerView | { error?: string };
        if (!response.ok || !isPitMapPlannerView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Pit Map Planner. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setErrorStatus(response.status);
            setLoadError("error" in data && data.error ? data.error : "");
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        setCachedAt(null);
        await persistPitMapSnapshot(urlOrg, seasonHint, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Pit Map Planner. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/pit-map-planner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as PitMapPlannerView | { error?: string };
        if (!response.ok || !isPitMapPlannerView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        void persistPitMapSnapshot(orgId, season != null ? String(season) : "", data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Pit Map Planner"}
          </>
        }
        title="Pit Map Planner"
        description="Plan the pit footprint, power budget, and tool placement — a printable map before you pack for the event."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>
      <OfflineBanner feature="Pit Map Planner" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: loadError,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: loadError || "A network or server issue prevented loading. Try again.",
            },
          );
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <Button as="a" variant="primary" href={copy.primary.href}>
                  {copy.primary.label}
                </Button>
              ) : null}
              {copy.showRetry ? (
                <Button variant="secondary" type="button" onClick={() => load()}>
                  Retry
                </Button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your team." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }} className="print-pit-map">
          <VenueMapPanel orgId={view.orgId} />
          <LayoutPanel view={view} busy={busy} mutate={mutate} />
          <PitMapCanvas view={view} />
          <AddItemForm busy={busy} mutate={mutate} />
          <ItemList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

/**
 * The REAL venue, when Nexus published one.
 *
 * This is the pit hall — where our pit sits and which neighbours have an open
 * parts request — and it is entirely separate from the footprint planner below,
 * which is our own 10x10 box. When Nexus has no geometry for the active event
 * this panel says exactly why and the planner underneath is unaffected: we do
 * not draw a stand-in venue.
 */
function VenueMapPanel({ orgId }: { orgId: string }) {
  const [venue, setVenue] = useState<NexusVenueMapView | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/nexus/venue-map?orgId=${encodeURIComponent(orgId)}`)
      .then((response) => response.json() as Promise<NexusVenueMapView | { error?: string }>)
      .then((data) => {
        if (cancelled) return;
        setVenue("status" in data ? data : null);
      })
      .catch(() => {
        // A failed venue lookup must never block the planner itself.
        if (!cancelled) setVenue(null);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  if (!venue) return null;

  if (venue.status === "setup_required") {
    return (
      <Panel>
        <h2 style={{ marginTop: 0 }}>Venue pit map</h2>
        <p className="app-muted">From frc.nexus — shown only when Nexus publishes it.</p>
        <p className="app-muted">{venue.message}</p>
      </Panel>
    );
  }

  const map = venue.map;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Venue pit map</h2>
      <p className="app-muted">{`${venue.eventName ?? venue.eventKey} · frc.nexus`}</p>
      <svg
        viewBox={map.viewBox}
        role="img"
        aria-label="Venue pit map from Nexus"
        style={{ width: "100%", height: "auto", maxHeight: "60vh" }}
      >
        {map.shapes.map((shape, index) => (
          <g
            key={shape.id ?? `${shape.kind}-${index}`}
            transform={
              shape.rotation
                ? `rotate(${shape.rotation} ${shape.x + shape.width / 2} ${shape.y + shape.height / 2})`
                : undefined
            }
          >
            <rect
              x={shape.x}
              y={shape.y}
              width={shape.width}
              height={shape.height}
              className={`venue-shape kind-${shape.kind}${shape.ours ? " is-ours" : ""}${
                shape.requester ? " is-requester" : ""
              }`}
            />
            {venueShapeLabel(shape) ? (
              <text
                x={shape.x + shape.width / 2}
                y={shape.y + shape.height / 2}
                dominantBaseline="middle"
                textAnchor="middle"
                className="venue-shape-label"
              >
                {venueShapeLabel(shape)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
      <p className="app-muted">
        {map.ourShape
          ? `Your pit is highlighted${venue.ourPitAddress ? ` (${venue.ourPitAddress})` : ""}.`
          : "Nexus did not place your team on this map."}
        {venue.syncedAt ? ` Synced ${new Date(venue.syncedAt).toLocaleString()}.` : ""}
      </p>
      {venue.requests.length ? (
        <ul className="venue-requests">
          {venue.requests.map((entry, index) => (
            <li key={`${entry.team ?? "team"}-${index}`}>
              {entry.team ? `Team ${entry.team}` : "A team"} needs {entry.parts}
              {entry.pitAddress ? ` · Pit ${entry.pitAddress}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function LayoutPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const layout = view.layout;
  const [form, setForm] = useState({
    footprintWidthFt: String(layout?.footprintWidthFt ?? 10),
    footprintDepthFt: String(layout?.footprintDepthFt ?? 10),
    powerCapacityAmps: String(layout?.powerCapacityAmps ?? 20),
    notes: layout?.notes ?? "",
  });
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const { summary } = view;

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({
          action: "set-layout",
          footprintWidthFt: Number(form.footprintWidthFt) || 10,
          footprintDepthFt: Number(form.footprintDepthFt) || 10,
          powerCapacityAmps: Number(form.powerCapacityAmps) || 0,
          notes: form.notes || undefined,
        });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0 }}>Pit footprint</h2>
          <small className="app-muted">
            {summary.usedAreaSqFt} of {summary.footprintAreaSqFt} sq ft used ({pct(summary.areaUtilization)}) ·{" "}
            {summary.totalPowerDrawAmps}A of {layout?.powerCapacityAmps ?? 0}A ({pct(summary.powerUtilization)})
            {summary.overCapacity ? " · over power budget" : ""}
          </small>
        </div>
        <Button variant="secondary" type="button" onClick={() => window.print()}>
          Print map
        </Button>
      </header>
      <FormGrid min={140}>
        <FormRow label="Width (ft)">
          <input type="number" min={1} step={0.5} value={form.footprintWidthFt} onChange={set("footprintWidthFt")} />
        </FormRow>
        <FormRow label="Depth (ft)">
          <input type="number" min={1} step={0.5} value={form.footprintDepthFt} onChange={set("footprintDepthFt")} />
        </FormRow>
        <FormRow label="Power budget (A)">
          <input type="number" min={0} step={1} value={form.powerCapacityAmps} onChange={set("powerCapacityAmps")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy}>
          Save layout
        </Button>
      </div>
    </Panel>
  );
}

function PitMapCanvas({ view }: { view: LiveView }) {
  const layout = view.layout;
  if (!layout || view.items.length === 0) {
    return (
      <EmptyState
        badge="No items placed yet"
        badgeTone="setup"
        title="Add workstations, power drops, and tool stations below"
        description="Once placed, they'll appear here to scale on the pit map."
      />
    );
  }

  const scale = 24; // px per ft
  const widthPx = Math.max(1, layout.footprintWidthFt) * scale;
  const depthPx = Math.max(1, layout.footprintDepthFt) * scale;

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Map</h2>
      <div
        style={{
          position: "relative",
          width: widthPx,
          height: depthPx,
          maxWidth: "100%",
          border: "2px solid var(--line, #444)",
          background: "var(--bg, rgba(127,127,127,0.06))",
          overflow: "auto",
        }}
      >
        {view.items.map((item) => (
          <div
            key={item.id}
            title={`${item.name} (${pitMapCategoryLabel(item.category)})`}
            style={{
              position: "absolute",
              left: item.xFt * scale,
              top: item.yFt * scale,
              width: Math.max(4, item.widthFt * scale),
              height: Math.max(4, item.depthFt * scale),
              border: "1px solid rgba(80,140,255,0.7)",
              background: "rgba(80,140,255,0.18)",
              fontSize: 11,
              padding: 2,
              overflow: "hidden",
            }}
          >
            {item.name}
          </div>
        ))}
      </div>
    </Panel>
  );
}

function AddItemForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      name: "",
      category: "workstation" as PitMapItemCategory,
      xFt: "0",
      yFt: "0",
      widthFt: "2",
      depthFt: "2",
      powerDrawAmps: "0",
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.name.trim()) return;
        mutate({
          action: "add-item",
          name: form.name,
          category: form.category,
          xFt: Number(form.xFt) || 0,
          yFt: Number(form.yFt) || 0,
          widthFt: Number(form.widthFt) || 2,
          depthFt: Number(form.depthFt) || 2,
          powerDrawAmps: Number(form.powerDrawAmps) || 0,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add item</h2>
      <FormGrid min={140}>
        <FormRow label="Name">
          <input value={form.name} onChange={set("name")} placeholder="Drive station" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {PIT_MAP_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {pitMapCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="X (ft)">
          <input type="number" step={0.5} value={form.xFt} onChange={set("xFt")} />
        </FormRow>
        <FormRow label="Y (ft)">
          <input type="number" step={0.5} value={form.yFt} onChange={set("yFt")} />
        </FormRow>
        <FormRow label="Width (ft)">
          <input type="number" min={0.5} step={0.5} value={form.widthFt} onChange={set("widthFt")} />
        </FormRow>
        <FormRow label="Depth (ft)">
          <input type="number" min={0.5} step={0.5} value={form.depthFt} onChange={set("depthFt")} />
        </FormRow>
        <FormRow label="Power draw (A)">
          <input type="number" min={0} step={0.5} value={form.powerDrawAmps} onChange={set("powerDrawAmps")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.name.trim()}>
          Add item
        </Button>
      </div>
    </Panel>
  );
}

function ItemList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalItems === 0) return null;
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Placed items</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.items.map((item) => (
          <li key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{item.name}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {pitMapCategoryLabel(item.category)} · {item.widthFt}×{item.depthFt} ft at ({item.xFt}, {item.yFt})
                {item.powerDrawAmps > 0 ? ` · ${item.powerDrawAmps}A` : ""}
                {item.notes ? ` · ${item.notes}` : ""}
              </small>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Remove "${item.name}"?`)) {
                  mutate({ action: "delete-item", itemId: item.id });
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
