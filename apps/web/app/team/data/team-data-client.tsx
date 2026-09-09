"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DataSourceDegradedBanner } from "../../../components/data-source-degraded-banner";
import { TeamDataRelated } from "../../../components/team-data-related";
import { EmptyState, Panel } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";
import type { DataSourceHealthView } from "../../../lib/reference-health";
import {
  TEAM_DATA_RELATED_INCLUDE,
  classifyTeamDataShell,
  isTbaConfigured,
  referenceCount,
  teamDataNextActions,
  type TeamDataNextAction,
  type TeamDataShellKind,
} from "../../../lib/team-data/team-data-related";

type InventoryRow = { label: string; count: number };
type Credential = {
  id: string;
  opaqueKeyId: string;
  status: string;
  lastTestedAt: string | null;
  disabledAt: string | null;
};

function TeamDataNextActionsPanel({ actions }: { actions: TeamDataNextAction[] }) {
  if (actions.length === 0) return null;
  return (
    <Panel className="team-data-next-actions edc-next-actions">
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function TeamDataShell({
  title,
  description,
  orgId,
  shell,
  hasActiveEvent,
  tbaConfigured,
  matchCount,
  metricCount,
  error,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: TeamDataShellKind;
  hasActiveEvent?: boolean;
  tbaConfigured?: boolean;
  matchCount?: number;
  metricCount?: number;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = teamDataNextActions({
    orgId,
    shell,
    hasActiveEvent,
    tbaConfigured,
    matchCount,
    metricCount,
  });
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";

  return (
    <main className="module-page team-data-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Live data</span>
          <h1>Team Data</h1>
          <p>{description}</p>
        </div>
        <TeamDataRelated orgId={orgId} include={[...TEAM_DATA_RELATED_INCLUDE]} />
      </header>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No TBA cache yet"
                : undefined
        }
        badgeTone={shell === "setup" || shell === "empty" ? "setup" : ""}
        title={title}
        description={
          shell === "error"
            ? error || "Check your connection and try again."
            : description
        }
        aria-busy={shell === "loading" || undefined}
      >
        <div className="team-data-inline-actions">
          {shell === "error" && onRetry ? (
            <button type="button" className="app-button secondary" onClick={onRetry}>
              Retry
            </button>
          ) : null}
          {shell === "setup" ? (
            <a className="app-button" href={workspaceHref}>
              Open Workspace
            </a>
          ) : null}
          <TeamDataRelated
            orgId={orgId}
            include={shell === "setup" ? ["schedule", "command", "strategy"] : [...TEAM_DATA_RELATED_INCLUDE]}
          />
        </div>
      </EmptyState>
      {shell !== "loading" ? <TeamDataNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function TeamDataClient({ orgId }: { orgId: string }) {
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [reference, setReference] = useState<InventoryRow[]>([]);
  const [activeEventKey, setActiveEventKey] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [dataSourceHealth, setDataSourceHealth] = useState<DataSourceHealthView | null>(null);
  const [key, setKey] = useState("");
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState("");

  const exportHref = withOrgHref("/exports", orgId);
  const exportPdfHref = withOrgHref("/exports?action=pdf", orgId);

  const load = useCallback(async () => {
    setError("");
    setFetchFailed(false);
    setForbidden(false);
    try {
      const response = await fetch(`/api/team/data?orgId=${encodeURIComponent(orgId)}`, {
        credentials: "include",
      });
      const data = (await response.json()) as {
        inventory?: InventoryRow[];
        reference?: InventoryRow[];
        activeEventKey?: string | null;
        credentials?: Credential[];
        health?: Record<string, unknown> | null;
        dataSourceHealth?: DataSourceHealthView;
        error?: string;
      };
      if (!response.ok) {
        setOk(false);
        setFetchFailed(true);
        setForbidden(response.status === 403);
        setError(data.error ?? "Unable to load team data");
        setMessage(data.error ?? "Unable to load team data");
        return;
      }
      setInventory(data.inventory ?? []);
      setReference(data.reference ?? []);
      setActiveEventKey(data.activeEventKey ?? null);
      setCredentials(data.credentials ?? []);
      setHealth(data.health ?? null);
      setDataSourceHealth(data.dataSourceHealth ?? null);
      setOk(true);
      setMessage("");
    } catch {
      setOk(false);
      setFetchFailed(true);
      setError("Unable to load team data");
      setMessage("Unable to load team data");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  async function syncActiveEvent() {
    setBusy(true);
    const response = await fetch("/api/team/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "sync" }),
    });
    const data = (await response.json()) as {
      summary?: Record<string, unknown>;
      error?: string;
    };
    setBusy(false);
    setOk(response.ok);
    if (response.ok) {
      const summary = data.summary;
      setMessage(
        `Sync finished — matches ${summary?.matches ?? 0}, teams ${summary?.teams ?? 0}, not-modified ${summary?.notModified ?? 0}.`,
      );
      await load();
    } else {
      setMessage(data.error ?? "Sync failed");
    }
  }

  async function saveFallbackKey(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/admin/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "save", apiKey: key }),
    });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    setOk(response.ok);
    setMessage(
      response.ok
        ? "Encrypted TBA fallback key saved. Test it before relying on it."
        : (data.error ?? "Save failed"),
    );
    if (response.ok) {
      setKey("");
      await load();
    }
  }

  async function testCredential(credentialId: string) {
    setBusy(true);
    const response = await fetch("/api/admin/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "test", credentialId }),
    });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    setOk(response.ok);
    setMessage(response.ok ? "Credential test succeeded." : (data.error ?? "Test failed"));
    if (response.ok) await load();
  }

  const hasActiveEvent = Boolean(activeEventKey);
  const tbaConfigured = isTbaConfigured({
    credentialCount: credentials.length,
    dataSourceMode: dataSourceHealth?.mode ?? null,
    cacheHasRows: dataSourceHealth?.cacheHasRows,
    healthStatus:
      dataSourceHealth?.sources.find((source) => source.source === "tba")?.status ??
      (typeof health?.status === "string" ? health.status : null),
  });
  const matchCount = referenceCount(reference, "matches_ref");
  const metricCount = referenceCount(reference, "team_event_metrics");
  const shell = classifyTeamDataShell({
    loading,
    fetchFailed,
    forbidden,
    orgId,
    hasActiveEvent: loading ? undefined : hasActiveEvent,
    tbaConfigured: loading ? undefined : tbaConfigured,
    matchCount,
    metricCount,
  });

  const nextActions = teamDataNextActions({
    orgId,
    shell,
    hasActiveEvent,
    tbaConfigured,
    matchCount,
    metricCount,
  });

  if (shell === "loading") {
    return (
      <TeamDataShell
        title="Loading…"
        description="Checking workspace event, TBA credentials, and Neon reference cache."
        orgId={orgId}
        shell="loading"
      />
    );
  }

  if (shell === "error") {
    return (
      <TeamDataShell
        title={forbidden ? "Admin access required" : "Team Data unavailable"}
        description="Inventory and event data appear after your first sync."
        orgId={orgId}
        shell="error"
        error={error || message}
        onRetry={() => {
          setLoading(true);
          void load();
        }}
      />
    );
  }

  if (shell === "setup") {
    const needsEvent = !hasActiveEvent;
    const needsTba = hasActiveEvent && !tbaConfigured;
    return (
      <TeamDataShell
        title={needsEvent ? "Select an active event" : needsTba ? "Connect TBA" : "Finish Team Data setup"}
        description={
          needsEvent
            ? "Team Data syncs only for a real workspace event — Schedule, Event Day, and Strategy stay empty until then."
            : needsTba
              ? "Save an encrypted TBA fallback key (or ask a platform admin for TBA_AUTH_KEY)."
              : "Finish workspace setup so TBA sync can resolve your organization."
        }
        orgId={orgId}
        shell="setup"
        hasActiveEvent={hasActiveEvent}
        tbaConfigured={tbaConfigured}
      >
        {needsTba ? (
          <section className="app-card soft-panel team-data-panel">
            <h2>TBA fallback key</h2>
            <p className="app-muted">
              Optional encrypted fallback when platform ingest needs an org credential. Never shown again after save.
            </p>
            <form className="team-data-key-form" onSubmit={saveFallbackKey}>
              <label>
                TBA Read API v3 key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="Encrypted on save — never shown again"
                  required
                />
              </label>
              <button type="submit" className="app-button secondary" disabled={busy || !key.trim()}>
                Encrypt and save
              </button>
            </form>
            {message ? (
              <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
                {message}
              </p>
            ) : null}
          </section>
        ) : null}
      </TeamDataShell>
    );
  }

  return (
    <main className="module-page team-data-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Live data</span>
          <h1>Team Data</h1>
          <p>
            Inventory counts for your workspace, shared TBA cache health, and controlled sync for the active event.
            Schedule, Event Day, and Strategy read this Neon cache.
          </p>
        </div>
        <div className="team-data-header-actions">
          <TeamDataRelated orgId={orgId} include={[...TEAM_DATA_RELATED_INCLUDE]} />
          <a className="app-button secondary" href={exportHref}>
            Export Center
          </a>
          <a className="app-button secondary" href={exportPdfHref}>
            PDF inventory
          </a>
        </div>
      </header>

      {message ? (
        <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <DataSourceDegradedBanner health={dataSourceHealth} />

      {shell === "empty" ? (
        <>
          <EmptyState
            soft
            badge="No TBA cache yet"
            badgeTone="setup"
            title="Sync the active event"
            description={`Event ${activeEventKey} is selected, but Neon has no match or team-metric rows yet. Sync pulls real TBA data — nothing is invented.`}
          >
            <div className="team-data-inline-actions">
              <button type="button" className="app-button" disabled={busy} onClick={() => void syncActiveEvent()}>
                {busy ? "Working…" : "Sync active event"}
              </button>
              <TeamDataRelated orgId={orgId} include={[...TEAM_DATA_RELATED_INCLUDE]} />
            </div>
          </EmptyState>
          <TeamDataNextActionsPanel actions={nextActions} />
        </>
      ) : null}

      <div className="team-data-layout">
        <section className="app-card soft-panel team-data-panel">
          <h2>Workspace inventory</h2>
          <p className="app-muted">
            Active event: <strong>{activeEventKey ?? "Not set"}</strong>
          </p>
          {inventory.length === 0 ? (
            <p className="app-muted">Nothing in this workspace yet — counts appear once your team adds data.</p>
          ) : (
            <ul className="team-data-inventory">
              {inventory.map((row) => (
                <li key={row.label}>
                  <span>{row.label.replace(/_/g, " ")}</span>
                  <strong>{row.count.toLocaleString()}</strong>
                </li>
              ))}
            </ul>
          )}
          <h3>Shared reference cache</h3>
          {reference.length === 0 ? (
            <p className="app-muted">Reference cache empty until TBA sync succeeds for this event.</p>
          ) : (
            <ul className="team-data-inventory reference">
              {reference.map((row) => (
                <li key={row.label}>
                  <span>{row.label.replace(/_/g, " ")}</span>
                  <strong>{row.count.toLocaleString()}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="team-data-side">
          <section className="app-card soft-panel team-data-panel">
            <h2>Sync active event</h2>
            <p className="app-muted">
              Refreshes match and team data for the event selected in Workspace / Event Day. Uses the platform key with
              your fallback credential when configured.
            </p>
            <button type="button" className="app-button" disabled={busy || !hasActiveEvent} onClick={() => void syncActiveEvent()}>
              {busy ? "Working…" : "Sync active event"}
            </button>
          </section>

          <section className="app-card soft-panel team-data-panel">
            <h2>TBA fallback key</h2>
            <p className="app-muted">
              Optional encrypted fallback when platform ingest is under pressure. Saved via the same connector path as
              team settings.
            </p>
            <form className="team-data-key-form" onSubmit={saveFallbackKey}>
              <label>
                TBA Read API v3 key
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="Encrypted on save — never shown again"
                  required
                />
              </label>
              <button type="submit" className="app-button secondary" disabled={busy || !key.trim()}>
                Encrypt and save
              </button>
            </form>
            {credentials.length ? (
              <ul className="team-data-credentials">
                {credentials.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.opaqueKeyId}</strong>
                      <small>{item.status}</small>
                    </div>
                    <button
                      type="button"
                      className="app-button secondary sm"
                      disabled={busy}
                      onClick={() => void testCredential(item.id)}
                    >
                      Test
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted">No fallback credential configured.</p>
            )}
          </section>

          <section className="app-card soft-panel team-data-panel">
            <h2>Ingestion health</h2>
            {dataSourceHealth ? (
              <ul className="team-data-inventory">
                <li>
                  <span>Mode</span>
                  <strong>{dataSourceHealth.mode}</strong>
                </li>
                <li>
                  <span>Last-good Neon cache</span>
                  <strong>
                    {dataSourceHealth.usingLastGoodCache
                      ? "in use"
                      : dataSourceHealth.cacheHasRows
                        ? "ready"
                        : "empty"}
                  </strong>
                </li>
                {dataSourceHealth.sources.map((source) => (
                  <li key={source.source}>
                    <span>
                      {source.source.toUpperCase()}
                      {source.etagResources ? ` · ${source.etagResources} ETags` : ""}
                      {source.erroredResources ? ` · ${source.erroredResources} cursor errors` : ""}
                    </span>
                    <strong>{source.status}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted">No health telemetry yet — sync once to populate real TBA status.</p>
            )}
            <pre className="team-data-health">{health ? JSON.stringify(health, null, 2) : "No health telemetry yet."}</pre>
          </section>
        </aside>
      </div>

      {shell === "ready" ? <TeamDataNextActionsPanel actions={nextActions} /> : null}
    </main>
  );
}
