"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import {
  OFFLINE_SHELL_RELATED_INCLUDE,
  classifyOfflineShell,
  formatOfflineCount,
  offlineReadinessTone,
  offlineRelatedLinks,
  offlineShellCopy,
  offlineShellNextActions,
  type OfflineShellKind,
} from "../../lib/offline/offline-related";
import { OFFLINE_SHELL_NETWORK_STATUSES, offlineShellNetworkStatusLabel } from "../../lib/offline-shell";
import type { OfflineShellView } from "../../lib/offline-shell/compute-offline-shell";
import type { OfflineShellNetworkStatus } from "../../lib/offline-shell/types";
import { OfflineBanner } from "../../components/offline-banner";
import "./offline-shell.css";

const COMPONENT_LABEL: Record<string, string> = {
  routeCoverage: "Shell route coverage",
  deviceCoverage: "Device coverage",
  recency: "Sync recency",
  offlineVerified: "Verified offline",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type LiveView = Extract<OfflineShellView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId: string | null }) {
  const links = offlineRelatedLinks(orgId, {
    active: "offline-shell",
    include: [...OFFLINE_SHELL_RELATED_INCLUDE],
  });
  return (
    <nav className="product-hub-related offline-shell-related" aria-label="Related offline tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActions({
  orgId,
  shell,
  recommendations,
}: {
  orgId: string | null;
  shell: OfflineShellKind;
  recommendations?: string[];
}) {
  const actions = offlineShellNextActions({ orgId, shell, recommendations });
  if (!actions.length) return null;
  return (
    <section className="offline-shell-next-actions app-card soft-panel edc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
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

export default function OfflineShellClient() {
  const [view, setView] = useState<OfflineShellView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const loading = view == null && !fetchFailed;
  const shell = classifyOfflineShell({
    loading,
    fetchFailed,
    status: view?.status ?? null,
    tier: view && view.status === "live" ? view.readiness.tier : null,
    totalEvents: view && view.status === "live" ? view.summary.totalEvents : 0,
  });
  const shellCopy = offlineShellCopy(shell);
  const recommendations =
    view && view.status === "live" ? view.readiness.recommendations : undefined;

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
    <main className="module-page offline-shell-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/team?orgId=${encodeURIComponent(orgId)}` : "/team"}>Team</a>
            {" / This phone"}
          </>
        }
        title="This phone without signal"
        description="See whether Scouting and the schedule stay on this device when venue Wi-Fi dies. Counts come from visits you already made."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      <OfflineBanner feature="This phone" fromCache={false} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState soft title={shellCopy.title} description={shellCopy.description}>
          <NextActions orgId={orgId} shell="error" />
          <Button variant="secondary" type="button" onClick={() => load()}>
            Retry
          </Button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState soft title={shellCopy.title} description={shellCopy.description} aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState soft badge={shellCopy.badge} badgeTone="setup" title={shellCopy.title} description={shellCopy.description}>
          <NextActions orgId={null} shell="setup" />
          
        </EmptyState>
      ) : (
        <div className="offline-shell-stack">
          <NextActions orgId={orgId} shell={shell} recommendations={recommendations} />
          <ReadinessPanel view={view} />
          <SummaryTiles view={view} loaded />
          <LogCacheEventForm busy={busy} mutate={mutate} />
          <RecentEvents view={view} busy={busy} mutate={mutate} orgId={orgId} shell={shell} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  const components = Object.entries(readiness.components) as Array<[string, number]>;
  const tone = offlineReadinessTone(readiness.tier);
  return (
    <Panel aria-label="Offline shell readiness" className="offline-shell-readiness">
      <header className="offline-shell-readiness-header">
        <div>
          <span className={`app-badge ${tone}`}>{readiness.tier.replace("_", " ").toUpperCase()}</span>
          <h2>Saved on this phone</h2>
          <small className="app-muted">
            {formatOfflineCount(view.summary.deviceCount, true)} device(s) reporting ·{" "}
            {formatOfflineCount(view.summary.offlineVerifiedCount, true)} verified offline — from logged syncs only
          </small>
        </div>
        <strong className="offline-shell-score">{pct(readiness.score)}</strong>
      </header>
      <div className="offline-shell-meters">
        {components.map(([key, value]) => (
          <div key={key} className="offline-shell-meter">
            <span className="app-muted">{COMPONENT_LABEL[key] ?? key}</span>
            <span className="mini-probability" aria-hidden="true">
              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
            </span>
            <small className="app-muted">{pct(value)}</small>
          </div>
        ))}
      </div>
      {readiness.recommendations.length > 0 ? (
        <div className="offline-shell-recs">
          <strong className="app-muted">From real sync logs</strong>
          <ul>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view, loaded }: { view: LiveView; loaded: boolean }) {
  const { summary } = view;
  const tiles = [
    { label: "Sync events", value: formatOfflineCount(summary.totalEvents, loaded) },
    { label: "Devices", value: formatOfflineCount(summary.deviceCount, loaded) },
    { label: "Routes cached", value: formatOfflineCount(summary.routesCovered.length, loaded) },
    { label: "Cache size", value: formatBytes(summary.totalCacheBytes) },
    { label: "Last sync", value: summary.lastSyncAt ? new Date(summary.lastSyncAt).toLocaleString() : "—" },
  ];
  return (
    <Panel aria-label="Offline shell summary">
      <div className="offline-shell-tiles">
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      <p className="app-muted offline-shell-tiles-note">Blank or zero until someone opens Scouting on this device while online.</p>
    </Panel>
  );
}

function RecentEvents({
  view,
  busy,
  mutate,
  orgId,
  shell,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  orgId: string | null;
  shell: OfflineShellKind;
}) {
  if (view.summary.totalEvents === 0) {
    const copy = offlineShellCopy("empty");
    return (
      <EmptyState soft badge={copy.badge} badgeTone="setup" title={copy.title} description={copy.description}>
        <NextActions orgId={orgId} shell={shell} />
      </EmptyState>
    );
  }
  return (
    <Panel>
      <h2 className="offline-shell-panel-title">Recent sync events</h2>
      <ul className="offline-shell-events">
        {view.events.slice(0, 20).map((item) => (
          <li key={item.id}>
            <div>
              <strong>{item.deviceLabel}</strong>
              <small className="app-muted">
                {new Date(item.occurredAt).toLocaleString()} · {offlineShellNetworkStatusLabel(item.networkStatus)} ·{" "}
                {item.routeCount} route(s) · {formatBytes(item.cacheBytes)}
              </small>
              <small className="app-muted">{item.routes.join(", ") || "No routes recorded"}</small>
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
      id="offline-shell-log"
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
      className="offline-shell-log-form"
    >
      <h2 className="offline-shell-panel-title">Mark this phone ready</h2>
      <p className="app-muted">Record each device once you have warmed it up and checked it works.</p>
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
        <Button variant="primary" type="submit" disabled={busy || !form.deviceLabel.trim()}>
          Log sync event
        </Button>
      </div>
    </Panel>
  );
}
