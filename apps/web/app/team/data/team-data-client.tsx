"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DataSourceDegradedBanner } from "../../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../../components/offline-banner";
import { TeamDataRelated } from "../../../components/team-data-related";
import { EmptyState, Panel, Button } from "../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { degradedModeReasonLabel, degradedModeSourceLabel } from "../../../lib/degraded-mode";
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

type TeamDataSnapshot = {
  inventory: InventoryRow[];
  reference: InventoryRow[];
  activeEventKey: string | null;
  credentials: Credential[];
  health: Record<string, unknown> | null;
  dataSourceHealth: DataSourceHealthView | null;
};

function isTeamDataSnapshot(value: unknown): value is TeamDataSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as { inventory?: unknown; reference?: unknown };
  return Array.isArray(row.inventory) && Array.isArray(row.reference);
}

async function persistTeamDataSnapshot(orgId: string, data: TeamDataSnapshot): Promise<void> {
  if (!orgId) return;
  try {
    await putFeatureSnapshot("team-data", orgId, data);
  } catch {
    // Live Team Data already painted; IndexedDB is best-effort.
  }
}

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
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
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
  error,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: TeamDataShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
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
                ? "No official match cache yet"
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
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={workspaceHref}>Choose your team</Button>
        ) : null}
      </EmptyState>
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
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const paintedOrgRef = useRef<string | null>(null);

  const exportHref = withOrgHref("/exports", orgId);
  const exportPdfHref = withOrgHref("/exports?action=pdf", orgId);

  const applySnapshot = useCallback((data: TeamDataSnapshot) => {
    setInventory(data.inventory);
    setReference(data.reference);
    setActiveEventKey(data.activeEventKey ?? null);
    setCredentials(data.credentials ?? []);
    setHealth(data.health ?? null);
    setDataSourceHealth(data.dataSourceHealth ?? null);
    paintedOrgRef.current = orgId;
  }, [orgId]);

  const load = useCallback(async () => {
    setError("");
    let hadCache = paintedOrgRef.current === orgId;
    try {
      const cached = await getFeatureSnapshot<TeamDataSnapshot>("team-data", orgId);
      if (paintedOrgRef.current !== orgId && cached?.data && isTeamDataSnapshot(cached.data)) {
        applySnapshot(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setLoading(false);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (!hadCache) setLoading(true);
    setFetchFailed(false);
    setForbidden(false);
    try {
      const response = await fetch(`/api/team/data?orgId=${encodeURIComponent(orgId)}`, {
        credentials: "include",
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as TeamDataSnapshot & { error?: string };
      if (response.status === 401 || response.status === 403) {
        setInventory([]);
        setReference([]);
        setActiveEventKey(null);
        setCredentials([]);
        setHealth(null);
        setDataSourceHealth(null);
        paintedOrgRef.current = null;
        setFromCache(false);
        setCachedAt(null);
        setOk(false);
        setFetchFailed(true);
        setForbidden(response.status === 403);
        setError(data.error ?? "Unable to load team data");
        setMessage(data.error ?? "Unable to load team data");
        return;
      }
      if (!response.ok || !isTeamDataSnapshot(data)) {
        if (hadCache || paintedOrgRef.current === orgId) {
          setFromCache(true);
          setFetchFailed(false);
          setMessage("Could not refresh Team Data. Showing the last copy on this device.");
        } else {
          setOk(false);
          setFetchFailed(true);
          setForbidden(false);
          setError(data.error ?? "Unable to load team data");
          setMessage(data.error ?? "Unable to load team data");
        }
        return;
      }
      applySnapshot({
        inventory: data.inventory,
        reference: data.reference,
        activeEventKey: data.activeEventKey ?? null,
        credentials: data.credentials ?? [],
        health: data.health ?? null,
        dataSourceHealth: data.dataSourceHealth ?? null,
      });
      setOk(true);
      setMessage("");
      setFromCache(false);
      setCachedAt(null);
      await persistTeamDataSnapshot(orgId, {
        inventory: data.inventory,
        reference: data.reference,
        activeEventKey: data.activeEventKey ?? null,
        credentials: data.credentials ?? [],
        health: data.health ?? null,
        dataSourceHealth: data.dataSourceHealth ?? null,
      });
    } catch {
      if (hadCache || paintedOrgRef.current === orgId) {
        setFromCache(true);
        setFetchFailed(false);
        setMessage("Could not refresh Team Data. Showing the last copy on this device.");
      } else {
        setOk(false);
        setFetchFailed(true);
        setError("Unable to load team data");
        setMessage("Unable to load team data");
      }
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncActiveEvent() {
    setBusy(true);
    const response = await fetch("/api/team/data", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, action: "sync" }),
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    setOk(response.ok);
    setMessage(
      response.ok
        ? "Encrypted official-match fallback key saved. Test it before relying on it."
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
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
        description="Checking your event and official match connection."
        orgId={orgId}
        shell="loading"
      >
        <OfflineBanner feature="Team Data" fromCache={fromCache} cachedAt={cachedAt} />
      </TeamDataShell>
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
          void load();
        }}
      >
        <OfflineBanner feature="Team Data" fromCache={fromCache} cachedAt={cachedAt} />
      </TeamDataShell>
    );
  }

  if (shell === "setup") {
    const needsEvent = !hasActiveEvent;
    // Was `hasActiveEvent && !tbaConfigured`, which hid the key form behind the
    // event picker. Every "Connect TBA" button in the product — the dashboard
    // widget, the setup checklist, Command's empty state — lands here, and a
    // workspace that has not picked an event yet (the common case for a team
    // setting Vantage up) got "Set your active event" and no way to connect
    // TBA at all. The two are independent: a key can be saved before an event
    // exists, and both are needed before anything syncs.
    const needsTba = !tbaConfigured;
    return (
      <TeamDataShell
        title={needsTba ? "Connect TBA" : needsEvent ? "Set active event" : "Finish Team Data setup"}
        description={
          needsTba
            ? `Save a TBA Read API key below, or ask whoever set up this site to add one in deployment settings. Create a key at thebluealliance.com → Account → Read API Keys.${needsEvent ? " You will also need to pick an active event before anything syncs." : ""}`
            : needsEvent
              ? "Team Data syncs only for a real team event — Schedule, Event Day, and Strategy stay empty until then."
              : "Finish team setup so official matches can load this team."
        }
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Team Data" fromCache={fromCache} cachedAt={cachedAt} />
        {needsTba ? (
          <section className="app-card soft-panel team-data-panel">
            <h2>Connect TBA team key</h2>
            <p className="app-muted">
              Encrypted on save and never shown again. Create one at thebluealliance.com → Account → Read API
              Keys. A site-wide TBA key in deployment settings covers every team and makes this unnecessary.
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
              <Button variant="secondary" type="submit" disabled={busy || !key.trim()}>
                Encrypt and save
              </Button>
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
            Inventory counts for your team, shared official match cache health, and controlled sync for the active event.
            Schedule, Event Day, and Strategy use this shared copy of official matches.
          </p>
        </div>
        <div className="team-data-header-actions">
          <TeamDataRelated orgId={orgId} include={[...TEAM_DATA_RELATED_INCLUDE]} />
          <Button as="a" variant="secondary" href={exportHref}>
            Export Center
          </Button>
          <Button as="a" variant="secondary" href={exportPdfHref}>
            PDF inventory
          </Button>
        </div>
      </header>

      <OfflineBanner feature="Team Data" fromCache={fromCache} cachedAt={cachedAt} />

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
            badge="No official match cache yet"
            badgeTone="setup"
            title="Sync the active event"
            description={`Event ${activeEventKey} is selected, but there are no match or ranking rows yet. Sync pulls official match data.`}
          >
            <Button variant="primary" type="button" disabled={busy} onClick={() => void syncActiveEvent()}>
              {busy ? "Working…" : "Sync active event"}
            </Button>
          </EmptyState>
        </>
      ) : null}

      <div className="team-data-layout">
        <section className="app-card soft-panel team-data-panel">
          <h2>Team inventory</h2>
          <p className="app-muted">
            Active event: <strong>{activeEventKey ?? "Not set"}</strong>
          </p>
          {inventory.length === 0 ? (
            <p className="app-muted">Nothing on this team yet — counts appear once your team adds data.</p>
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
            <p className="app-muted">Reference cache empty until official match sync succeeds for this event.</p>
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
              Refreshes match and team data for the event selected on Event Day. Uses the platform key with
              your fallback credential when configured.
            </p>
            <Button variant="primary" type="button" disabled={busy || !hasActiveEvent} onClick={() => void syncActiveEvent()}>
              {busy ? "Working…" : "Sync active event"}
            </Button>
          </section>

          <section className="app-card soft-panel team-data-panel">
            <h2>Connect TBA fallback key</h2>
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
              <Button variant="secondary" type="submit" disabled={busy || !key.trim()}>
                Encrypt and save
              </Button>
            </form>
            {credentials.length ? (
              <ul className="team-data-credentials">
                {credentials.map((item) => (
                  <li key={item.id}>
                    <div>
                      <strong>{item.opaqueKeyId}</strong>
                      <small>{item.status}</small>
                    </div>
                    <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void testCredential(item.id)}>
                      Test
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted">No fallback credential configured.</p>
            )}
          </section>

          <section className="app-card soft-panel team-data-panel">
            <h2>Official match status</h2>
            {dataSourceHealth ? (
              <ul className="team-data-inventory">
                <li>
                  <span>Status</span>
                  <strong>{degradedModeReasonLabel(dataSourceHealth.mode)}</strong>
                </li>
                <li>
                  <span>Last saved copy</span>
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
                      {degradedModeSourceLabel(source.source)}
                      {source.etagResources ? ` · ${source.etagResources} saved copies` : ""}
                      {source.erroredResources ? ` · ${source.erroredResources} failed copies` : ""}
                    </span>
                    <strong>{degradedModeReasonLabel(source.status)}</strong>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="app-muted">No official match status yet — sync once after Connect TBA to populate real official match status.</p>
            )}
          </section>
        </aside>
      </div>

      {shell === "ready" ? <TeamDataNextActionsPanel actions={nextActions} /> : null}
    </main>
  );
}
