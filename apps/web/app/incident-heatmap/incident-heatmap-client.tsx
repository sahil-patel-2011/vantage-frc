"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { incidentContextLabel } from "../../lib/incident-heatmap";
import { INCIDENT_CONTEXTS, type IncidentHeatmapView } from "../../lib/incident-heatmap/compute-incident-heatmap";
import type { IncidentContext } from "../../lib/incident-heatmap/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function heatColor(count: number, max: number): string {
  if (count <= 0) return "transparent";
  const intensity = Math.min(1, count / Math.max(1, max));
  const alpha = 0.15 + intensity * 0.65;
  return `rgba(220, 80, 60, ${alpha.toFixed(2)})`;
}

type LiveView = Extract<IncidentHeatmapView, { status: "live" }>;

function isIncidentHeatmapView(value: unknown): value is IncidentHeatmapView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function incidentHeatmapCacheOrg(data: IncidentHeatmapView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return (typeof data.orgId === "string" && data.orgId.trim()) || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistIncidentHeatmapSnapshot(
  orgHint: string,
  seasonHint: string,
  data: IncidentHeatmapView,
): Promise<void> {
  const cacheOrg = incidentHeatmapCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("incident-heatmap", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("incident-heatmap", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Incidents already painted; IndexedDB is best-effort.
  }
}

function IncidentHeatmapRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related robot tools">
      <Button as="a" variant="secondary" href={hubHref("/build", "failure-patterns", orgId)}>
        Failure patterns
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/build", "fmea", orgId)}>
        Failure log
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/team", "safety", orgId)}>
        Safety log
      </Button>
    </nav>
  );
}

function IncidentHeatmapNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "log",
      label: "Log an incident",
      detail: "Subsystem and when it broke — the heatmap is only as honest as this log.",
      href: "#incident-heatmap-form",
      primary: true,
    },
    {
      id: "fmea",
      label: "Open Failure log",
      detail: "Repeat failures should match the risk rows.",
      href: hubHref("/build", "fmea", orgId),
      primary: false,
    },
    {
      id: "patterns",
      label: "Open Failure patterns",
      detail: "Same mechanism across events lives next to this heatmap.",
      href: hubHref("/build", "failure-patterns", orgId),
      primary: false,
    },
  ];
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function IncidentHeatmapClient() {
  const [view, setView] = useState<IncidentHeatmapView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<IncidentHeatmapView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<IncidentHeatmapView>(
        "incident-heatmap",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isIncidentHeatmapView(cached.data)) {
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
    setError("");
    setErrorStatus(null);
    setLoadError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/incident-heatmap${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isIncidentHeatmapView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Incidents. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistIncidentHeatmapSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Incidents. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/incident-heatmap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isIncidentHeatmapView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistIncidentHeatmapSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const buildHref = orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={buildHref}>Build</a>
          {" / Incidents"}
        </>
      }
      title="Incidents"
      description="Log incidents by subsystem and time to spot hotspots — which subsystem keeps breaking, and when."
    >
      <IncidentHeatmapRelated orgId={orgId} />
      {view?.status === "live" && view.seasons.length > 0 ? (
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Season
          <select
            value={season ?? view.seasonYear}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSeason(next);
              void load(next);
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
  );

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
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
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Incidents" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Opening Incidents"}
          description={failure ? failure.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {failure?.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure?.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          {header}
          <OfflineBanner feature="Incidents" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState
            badge="Needs setup"
            badgeTone="setup"
            title="Choose your team"
            description={view.message}
          >
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      {header}
      <OfflineBanner feature="Incidents" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <IncidentHeatmapNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <LogIncidentForm busy={busy} mutate={mutate} />
        {view.summary.totalIncidents > 0 ? (
          <>
            <HeatmapGrid view={view} />
            <Breakdowns view={view} />
          </>
        ) : null}
        <RecentIncidents view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Incidents", value: String(summary.totalIncidents) },
    { label: "Subsystems affected", value: String(summary.bySubsystem.length) },
    { label: "Weeks with incidents", value: String(summary.buckets.length) },
    { label: "Hottest subsystem", value: summary.hottestSubsystem ?? "—" },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function HeatmapGrid({ view }: { view: LiveView }) {
  const { summary } = view;
  const subsystems = summary.bySubsystem.map((s) => s.subsystem);
  const buckets = summary.buckets;
  const maxCount = summary.cells.reduce((max, cell) => Math.max(max, cell.count), 1);
  const cellFor = (subsystem: string, bucket: string) =>
    summary.cells.find((cell) => cell.subsystem === subsystem && cell.bucket === bucket)?.count ?? 0;

  return (
    <Panel style={{ overflowX: "auto" }}>
      <h2 style={{ marginTop: 0 }}>Heatmap: subsystem × week</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "4px 8px" }}>Subsystem</th>
            {buckets.map((bucket) => (
              <th key={bucket} style={{ padding: "4px 8px", fontWeight: 400 }} className="app-muted">
                {bucket}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {subsystems.map((subsystem) => (
            <tr key={subsystem}>
              <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>{subsystem}</td>
              {buckets.map((bucket) => {
                const count = cellFor(subsystem, bucket);
                return (
                  <td
                    key={bucket}
                    title={`${subsystem} · ${bucket}: ${count}`}
                    style={{
                      padding: "4px 8px",
                      textAlign: "center",
                      minWidth: 44,
                      background: heatColor(count, maxCount),
                      borderRadius: 4,
                    }}
                  >
                    {count > 0 ? count : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Breakdowns({ view }: { view: LiveView }) {
  const { summary } = view;
  return (
    <section
      className="app-card soft-panel"
      style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}
    >
      <div>
        <h2 style={{ marginTop: 0 }}>By subsystem</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.bySubsystem.map((row) => (
            <li key={row.subsystem} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{row.subsystem}</span>
              <small className="app-muted">
                {row.count} · {Math.round(row.shareOfTotal * 100)}%
              </small>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 style={{ marginTop: 0 }}>By context</h2>
        <ul className="factor-table" style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
          {summary.byContext.map((row) => (
            <li key={row.context} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{incidentContextLabel(row.context)}</span>
              <small className="app-muted">{row.count}</small>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function RecentIncidents({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalIncidents === 0) {
    return (
      <EmptyState
        badge="No incidents yet"
        badgeTone="setup"
        title="Log your first incident"
        description="Every logged incident — match, pit, practice, or inspection — feeds the subsystem hotspot heatmap."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent incidents</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.incidents.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.subsystem} · {incidentContextLabel(item.context)} · {item.occurredAt.slice(0, 16).replace("T", " ")}
                {item.matchKey ? ` · ${item.matchKey}` : ""}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-incident", incidentId: item.id });
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogIncidentForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      subsystem: "",
      title: "",
      context: "pit" as IncidentContext,
      matchKey: "",
      eventKey: "",
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
      id="incident-heatmap-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.subsystem.trim() || !form.title.trim()) return;
        mutate({
          action: "log-incident",
          subsystem: form.subsystem,
          title: form.title,
          context: form.context,
          matchKey: form.matchKey || undefined,
          eventKey: form.eventKey || undefined,
          notes: form.notes || undefined,
          occurredAt: new Date().toISOString(),
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log incident</h2>
      <FormGrid min={160}>
        <FormRow label="Subsystem">
          <input value={form.subsystem} onChange={set("subsystem")} placeholder="Intake" required />
        </FormRow>
        <FormRow label="Title">
          <input value={form.title} onChange={set("title")} placeholder="Intake roller jammed" required />
        </FormRow>
        <FormRow label="Context">
          <select value={form.context} onChange={set("context")}>
            {INCIDENT_CONTEXTS.map((context) => (
              <option key={context} value={context}>
                {incidentContextLabel(context)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026casj_qm12" />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026casj" />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.subsystem.trim() || !form.title.trim()}>
          Log incident
        </Button>
      </div>
    </Panel>
  );
}
