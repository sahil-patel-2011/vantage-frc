"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { failurePatternNoteStatusLabel, failurePatternTierLabel } from "../../lib/failure-patterns";
import {
  FAILURE_PATTERN_NOTE_STATUSES,
  type FailurePatternsView,
} from "../../lib/failure-patterns/compute-failure-patterns";
import type { FailurePatternCluster, FailurePatternNoteStatus, FailurePatternTier } from "../../lib/failure-patterns/types";

function tierTone(tier: FailurePatternTier): string {
  if (tier === "critical") return "demo";
  if (tier === "watch") return "setup";
  return "good";
}

type LiveView = Extract<FailurePatternsView, { status: "live" }>;

export default function FailurePatternsClient() {
  const [view, setView] = useState<FailurePatternsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/failure-patterns${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as FailurePatternsView | { error?: string };
        if (!response.ok || !("status" in data)) {
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
        const response = await fetch("/api/failure-patterns", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as FailurePatternsView | { error?: string };
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
            {" / Repeat Failure Patterns"}
          </>
        }
        title="Repeat Failure Patterns"
        description="Clusters your FMEA failure log and equipment incidents by subsystem to surface which mechanisms keep breaking — grounded only in what your team has logged."
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
        <EmptyState
          title="Could not load failure patterns"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
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
          {view.clusters.length === 0 ? (
            <EmptyState
              badge="No failures logged"
              badgeTone="setup"
              title="No FMEA or incident records yet this season"
              description="Log failures in the FMEA failure log or equipment incidents, and repeat-failure clusters will appear here automatically."
            >
              <a className="app-button secondary" href={orgId ? `/pit-repair-triage?orgId=${encodeURIComponent(orgId)}` : "/pit-repair-triage"}>
                Open pit repair triage
              </a>
            </EmptyState>
          ) : (
            <ClusterList view={view} busy={busy} mutate={mutate} />
          )}
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Total events", value: String(summary.totalEvents) },
    { label: "Subsystems affected", value: String(summary.totalClusters) },
    { label: "Repeat-failure patterns", value: String(summary.repeatClusters) },
    { label: "Critical", value: String(summary.criticalClusters) },
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

function ClusterList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {view.clusters.map((cluster) => (
        <ClusterCard key={cluster.subsystemName} cluster={cluster} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function ClusterCard({
  cluster,
  busy,
  mutate,
}: {
  cluster: FailurePatternCluster;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<FailurePatternNoteStatus>("acknowledged");

  return (
    <Panel>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className={`app-badge ${tierTone(cluster.tier)}`}>{failurePatternTierLabel(cluster.tier)}</span>
          <h2 style={{ margin: "6px 0 0" }}>{cluster.subsystemName}</h2>
          <small className="app-muted">
            {cluster.totalCount} failure(s) · {cluster.fmeaCount} FMEA · {cluster.incidentCount} incident(s) ·{" "}
            {cluster.firstOccurredOn} → {cluster.lastOccurredOn}
          </small>
        </div>
        <div style={{ textAlign: "right" }}>
          <strong style={{ fontSize: "1.6rem" }}>{cluster.totalCount}×</strong>
          {cluster.maxSeverity != null ? (
            <small className="app-muted" style={{ display: "block" }}>
              max severity {cluster.maxSeverity}/10
            </small>
          ) : null}
        </div>
      </header>

      <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "grid", gap: 6 }}>
        {cluster.events.map((event) => (
          <li key={event.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>
              {event.title} <small className="app-muted">({event.source === "fmea" ? "FMEA" : "Incident"})</small>
            </span>
            <small className="app-muted">
              {event.occurredOn}
              {event.severity != null ? ` · sev ${event.severity}` : ""}
            </small>
          </li>
        ))}
      </ul>

      {cluster.latestNote ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          <strong>{failurePatternNoteStatusLabel(cluster.latestNote.status)}</strong>
          {cluster.latestNote.note ? `: ${cluster.latestNote.note}` : ""}
        </p>
      ) : null}

      <FormGrid min={160} style={{ marginTop: 12 }}>
        <FormRow label="Status">
          <select value={status} onChange={(event) => setStatus(event.target.value as FailurePatternNoteStatus)}>
            {FAILURE_PATTERN_NOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {failurePatternNoteStatusLabel(s)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Note (optional)">
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Corrective action taken" />
        </FormRow>
      </FormGrid>
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => {
            mutate({
              action: "log-note",
              subsystemName: cluster.subsystemName,
              status,
              note: note || undefined,
            });
            setNote("");
          }}
        >
          Log update
        </button>
      </div>
    </Panel>
  );
}
