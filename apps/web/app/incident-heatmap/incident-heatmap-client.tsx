"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { incidentContextLabel } from "../../lib/incident-heatmap";
import { INCIDENT_CONTEXTS, type IncidentHeatmapView } from "../../lib/incident-heatmap/compute-incident-heatmap";
import type { IncidentContext } from "../../lib/incident-heatmap/types";

function heatColor(count: number, max: number): string {
  if (count <= 0) return "transparent";
  const intensity = Math.min(1, count / Math.max(1, max));
  const alpha = 0.15 + intensity * 0.65;
  return `rgba(220, 80, 60, ${alpha.toFixed(2)})`;
}

type LiveView = Extract<IncidentHeatmapView, { status: "live" }>;

export default function IncidentHeatmapClient() {
  const [view, setView] = useState<IncidentHeatmapView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setErrorStatus(null);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/incident-heatmap${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as IncidentHeatmapView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setErrorStatus(response.status);
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      })
      .catch(() => setFetchFailed(true));
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
        const response = await fetch("/api/incident-heatmap", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as IncidentHeatmapView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
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
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Incident Heatmap"}
          </>
        }
        title="Incident Heatmap"
        description="Log incidents by subsystem and time to spot hotspots — which subsystem keeps breaking, and when."
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

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const kind = classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          });
          const copy = loadFailureCopy(kind, {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          });
          return (
            <EmptyState title={copy.title} description={copy.description}>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </EmptyState>
          );
        })()
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
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
      )}
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
        <button type="submit" className="app-button" disabled={busy || !form.subsystem.trim() || !form.title.trim()}>
          Log incident
        </button>
      </div>
    </Panel>
  );
}
