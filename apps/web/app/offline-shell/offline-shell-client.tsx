"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { OFFLINE_SHELL_NETWORK_STATUSES, offlineShellNetworkStatusLabel } from "../../lib/offline-shell";
import type { OfflineShellView } from "../../lib/offline-shell/compute-offline-shell";
import type { OfflineShellNetworkStatus, OfflineShellTier } from "../../lib/offline-shell/types";

const COMPONENT_LABEL: Record<string, string> = {
  routeCoverage: "Shell route coverage",
  deviceCoverage: "Device coverage",
  recency: "Sync recency",
  offlineVerified: "Verified offline",
};

function tierTone(tier: OfflineShellTier): string {
  if (tier === "ready") return "good";
  if (tier === "partial") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type LiveView = Extract<OfflineShellView, { status: "live" }>;

export default function OfflineShellClient() {
  const [view, setView] = useState<OfflineShellView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/offline-shell${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as OfflineShellView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
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
        const response = await fetch("/api/offline-shell", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as OfflineShellView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / Offline Shell"}
          </>
        }
        title="Offline Shell"
        description="Track service-worker precache readiness so scouting and schedule shell routes still cold-launch with no signal at the venue."
      >
        {orgId ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <a className="app-button secondary" href={`/scouting?orgId=${encodeURIComponent(orgId)}`}>
              Scouting shell
            </a>
            <a className="app-button secondary" href={`/schedule?orgId=${encodeURIComponent(orgId)}`}>
              Schedule shell
            </a>
          </div>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Offline Shell status"
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
          <ReadinessPanel view={view} />
          <SummaryTiles view={view} />
          <LogCacheEventForm busy={busy} mutate={mutate} />
          <RecentEvents view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const components = Object.entries(readiness.components) as Array<[string, number]>;
  return (
    <Panel aria-label="Offline shell readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.replace("_", " ").toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Offline-shell precache readiness</h2>
          <small className="app-muted">
            {view.summary.deviceCount} device(s) reporting · {view.summary.offlineVerifiedCount} verified offline
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        {components.map(([key, value]) => (
          <div key={key} style={{ display: "grid", gridTemplateColumns: "180px 1fr 48px", gap: 8, alignItems: "center" }}>
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted" style={{ textAlign: "right" }}>{pct(value)}</small>
          </div>
        ))}
      </div>
      {readiness.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Sync events", value: String(summary.totalEvents) },
    { label: "Devices", value: String(summary.deviceCount) },
    { label: "Routes cached", value: String(summary.routesCovered.length) },
    { label: "Cache size", value: formatBytes(summary.totalCacheBytes) },
    { label: "Last sync", value: summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : "—" },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RecentEvents({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalEvents === 0) {
    return (
      <EmptyState
        badge="No sync events yet"
        badgeTone="setup"
        title="Log your first offline-shell precache sync"
        description="Precache the scouting and schedule shells on a device, verify a cold launch offline, then log it here."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent sync events</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.events.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.deviceLabel}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {new Date(item.occurredAt).toLocaleString()} · {offlineShellNetworkStatusLabel(item.networkStatus)} ·{" "}
                {item.routeCount} route(s) · {formatBytes(item.cacheBytes)}
              </small>
              <small className="app-muted" style={{ display: "block" }}>
                {item.routes.join(", ") || "No routes recorded"}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete sync event for "${item.deviceLabel}"?`)) {
                  mutate({ action: "delete-cache-event", eventId: item.id });
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

function LogCacheEventForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      deviceLabel: "",
      routes: "/offline, /scouting, /schedule",
      cacheBytes: "",
      networkStatus: "offline" as OfflineShellNetworkStatus,
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
        if (!form.deviceLabel.trim()) return;
        mutate({
          action: "log-cache-event",
          deviceLabel: form.deviceLabel,
          routes: form.routes
            .split(",")
            .map((route) => route.trim())
            .filter(Boolean),
          cacheBytes: Number(form.cacheBytes) || 0,
          networkStatus: form.networkStatus,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a precache sync</h2>
      <FormGrid min={160}>
        <FormRow label="Device">
          <input value={form.deviceLabel} onChange={set("deviceLabel")} placeholder="Scout tablet A" required />
        </FormRow>
        <FormRow label="Cached routes (comma-separated)">
          <input value={form.routes} onChange={set("routes")} placeholder="/offline, /scouting, /schedule" />
        </FormRow>
        <FormRow label="Network status at verification">
          <select value={form.networkStatus} onChange={set("networkStatus")}>
            {OFFLINE_SHELL_NETWORK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {offlineShellNetworkStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Cache size (bytes, optional)">
          <input type="number" min={0} value={form.cacheBytes} onChange={set("cacheBytes")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Verified cold launch with airplane mode" />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.deviceLabel.trim()}>
          Log sync event
        </button>
      </div>
    </Panel>
  );
}
