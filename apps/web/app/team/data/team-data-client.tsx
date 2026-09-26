"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { DataSourceDegradedBanner } from "../../../components/data-source-degraded-banner";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, Button } from "../../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { loadFailureCopy } from "../../../lib/ui/load-failure";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import type { DataSourceHealthView } from "../../../lib/reference-health";
import { scoutEventLabel } from "../../../lib/scouting/scouting-related";
import {
  classifyTeamDataShell,
  isTbaConfigured,
  referenceCount,
  type TeamDataShellKind,
} from "../../../lib/team-data/team-data-related";
import { teamSettingsBreadcrumb } from "../../../lib/nav/team-settings-nav";
import { TeamSettingsNav } from "../../../components/team-settings-nav";

type InventoryRow = { label: string; count: number };

/** What each count is, in the words of the page that makes it (not the table it lives in). */
const ROW_NAMES: Record<string, string> = {
  match_scouting: "Match scouting entries",
  pit_scouting: "Pit scouting entries",
  disagreements: "Scout disagreements",
  research_findings: "Research findings",
  pick_lists: "Pick lists",
  display_boards: "TV boards",
  live_alerts: "Live alerts",
  ai_artifacts: "Saved AI answers",
  cad_jobs: "CAD agent runs",
  export_jobs: "Exports",
  teams_ref: "FRC teams",
  events_ref: "Events",
  matches_ref: "Matches at your event",
  team_event_metrics: "Team stats at your event",
};

/** Housekeeping counts a team never acts on; they stay on the platform admin's pages. */
const HIDDEN_ROWS = new Set(["ai_artifacts", "cad_jobs", "export_jobs", "live_alerts", "display_boards"]);

/** Rows worth showing a team: something they recorded, and not zero. */
function shownRows(rows: InventoryRow[]): InventoryRow[] {
  return rows.filter((row) => row.count > 0 && !HIDDEN_ROWS.has(row.label));
}

function rowName(label: string): string {
  const known = ROW_NAMES[label];
  if (known) return known;
  const words = label.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
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
  activeEventName?: string | null;
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

/**
 * The one place a team puts in its Blue Alliance key.
 *
 * This was two copies of the same <form>: one headed "Blue Alliance team key"
 * in the setup shell, one headed "Fallback key" further down the live page.
 * Same input, same endpoint, same handler — described once as the thing you
 * must do and once as an optional extra. Whichever a team found first became
 * what they believed, and the two beliefs disagreed.
 *
 * One panel now, and the copy tells the truth for the state it is actually in:
 * required when nothing is connected, a standby when the platform key is
 * already carrying this workspace.
 */
function TbaKeyPanel({
  required,
  value,
  onValueChange,
  onSubmit,
  busy,
  credentials,
  onTest,
  message,
  ok,
}: {
  required: boolean;
  value: string;
  onValueChange: (next: string) => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  credentials: Credential[];
  onTest?: (credentialId: string) => void;
  message: string;
  ok: boolean;
}) {
  const body = (
    <>
      <p className="app-muted">
        {required
          ? "Event data comes from The Blue Alliance. Make a free read key at thebluealliance.com → Account → Read API Keys and paste it here. It is kept encrypted and never shown again."
          : "Vantage already gets your event data. Adding your team's own Blue Alliance key keeps it coming if the shared connection is busy. It is kept encrypted and never shown again."}
      </p>
      <form className="team-data-key-form" onSubmit={onSubmit}>
        <label>
          Blue Alliance read key
          <input
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            placeholder="Encrypted on save — never shown again"
            required
          />
        </label>
        <Button variant="secondary" type="submit" disabled={busy || !value.trim()}>
          Save key
        </Button>
      </form>
      {message ? (
        <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}
      {onTest ? (
        credentials.length ? (
          <ul className="team-data-credentials">
            {credentials.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{item.opaqueKeyId}</strong>
                  <small>{item.status}</small>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={busy}
                  onClick={() => onTest(item.id)}
                >
                  Test
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="app-muted">No key saved for this team yet.</p>
        )
      ) : null}
      {/* Asked often enough to belong here rather than in a support article:
          people come to this panel hunting for a second field and do not find
          one. Statbotics genuinely has no key — saying so stops the hunt. */}
      <p className="app-muted team-data-statbotics">
        <strong>Team ratings need no key.</strong> They come from Statbotics,
        which is open to everyone.
      </p>
    </>
  );
  // Required: the panel leads. Optional: one folded line, so a working team isn't asked for a key.
  return required ? (
    <section className="app-card soft-panel team-data-panel">
      <h2>Blue Alliance key</h2>
      {body}
    </section>
  ) : (
    <details className="app-card soft-panel team-data-panel team-data-key-fold">
      <summary>Use your own Blue Alliance key (optional)</summary>
      {body}
    </details>
  );
}

function TeamDataShell({
  title,
  description,
  orgId,
  shell,
  error,
  badge,
  primary,
  onRetry,
  children,
}: {
  title: string;
  description: string;
  orgId?: string | null;
  shell: TeamDataShellKind;
  error?: string;
  badge?: string;
  primary?: { label: string; href: string };
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";

  return (
    <main className="module-page team-data-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">{teamSettingsBreadcrumb("data")}</span>
          <h1>Team data</h1>
          <p>{description}</p>
        </div>
        {orgId ? <TeamSettingsNav orgId={orgId} current="data" /> : null}
      </header>
      {children}
      <EmptyState
        soft
        badge={
          badge ??
          (shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No cache yet"
                : undefined)
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
        {primary ? (
          <Button as="a" variant="primary" href={primary.href}>
            {primary.label}
          </Button>
        ) : null}
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
  const [activeEventName, setActiveEventName] = useState<string | null>(null);
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
    setActiveEventName(data.activeEventName ?? null);
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
        setActiveEventName(null);
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
        activeEventName: data.activeEventName ?? null,
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
        activeEventName: data.activeEventName ?? null,
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
    // Data already here stays in use when a refresh fails: that is a busy connection, not an
    // unconnected team ("Match data isn't connected yet" showed above 36 cached matches).
    const haveData = referenceCount(reference, "matches_ref") > 0;
    setOk(response.ok || haveData);
    if (response.ok) {
      const summary = data.summary;
      const matches = Number(summary?.matches ?? 0);
      const teams = Number(summary?.teams ?? 0);
      setMessage(
        matches || teams
          ? `Updated just now · ${matches} ${matches === 1 ? "match" : "matches"}, ${teams} ${teams === 1 ? "team" : "teams"}.`
          : "Up to date. Nothing changed since the last refresh.",
      );
      await load();
    } else if (haveData) {
      setMessage("Couldn't refresh just now. The event data already here is still in use; try again in a few minutes.");
    } else {
      setMessage(data.error ?? "Couldn't refresh. Try again in a few minutes.");
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
      signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json()) as { error?: string };
    setBusy(false);
    setOk(response.ok);
    setMessage(response.ok ? "Credential test succeeded." : (data.error ?? "Test failed"));
    if (response.ok) await load();
  }

  const hasActiveEvent = Boolean(activeEventKey);
  const activeEventLabel = scoutEventLabel({ eventName: activeEventName, eventKey: activeEventKey }) ?? "Not set";
  const tbaConfigured = isTbaConfigured({
    credentialCount: credentials.length,
    dataSourceMode: dataSourceHealth?.mode ?? null,
    cacheHasRows: dataSourceHealth?.cacheHasRows,
    healthStatus:
      dataSourceHealth?.sources.find((source) => source.source === "tba")?.status ??
      (typeof health?.status === "string" ? health.status : null),
  });
  const tbaSuccess = dataSourceHealth?.sources.find((source) => source.source === "tba")?.lastSuccessAt ?? null;
  const lastRefreshed =
    tbaSuccess && !Number.isNaN(Date.parse(tbaSuccess))
      ? new Date(tbaSuccess).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })
      : null;
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

  if (shell === "loading") {
    return (
      <TeamDataShell
        title="Loading…"
        description="Checking your event and Team Data connection."
        orgId={orgId}
        shell="loading"
      >
        <OfflineBanner feature="Team Data" fromCache={fromCache} cachedAt={cachedAt} />
      </TeamDataShell>
    );
  }

  if (shell === "error") {
    const failure = forbidden ? loadFailureCopy("forbidden") : null;
    return (
      <TeamDataShell
        title={failure?.title ?? "Team Data unavailable"}
        description={
          failure
            ? "Owners and admins connect the event schedule here."
            : "Inventory and event data appear after your first sync."
        }
        orgId={orgId}
        shell="error"
        badge={failure?.badge}
        error={forbidden ? failure?.description : error || message}
        primary={failure?.primary}
        onRetry={
          forbidden
            ? undefined
            : () => {
                void load();
              }
        }
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
        title={needsTba ? "Connect Team Data" : needsEvent ? "Set active event" : "Finish Team Data setup"}
        description={
          needsTba
            ? `Save a Blue Alliance Read API key below, or ask whoever set up this site to add one in deployment settings. Create a key at thebluealliance.com → Account → Read API Keys.${needsEvent ? " You will also need to pick an active event before anything syncs." : ""}`
            : needsEvent
              ? "Team Data syncs only for a real team event — Schedule, Event Day, and Strategy stay empty until then."
              : "Finish team setup so Team Data sync can load this team."
        }
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Team Data" fromCache={fromCache} cachedAt={cachedAt} />
        {needsTba ? (
          <TbaKeyPanel
            required
            value={key}
            onValueChange={setKey}
            onSubmit={saveFallbackKey}
            busy={busy}
            credentials={credentials}
            message={message}
            ok={ok}
          />
        ) : null}
      </TeamDataShell>
    );
  }

  return (
    <main className="module-page team-data-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">{teamSettingsBreadcrumb("data")}</span>
          <h1>Team data</h1>
          <p>
            What your team has recorded, and the official event data that Schedule, Event day and Strategy
            use.
          </p>
        </div>
        {/* A settings page: the Schedule / Event day / Strategy links were a second nav above the
            chip row. */}
        <div className="team-data-header-actions">
          <Button as="a" variant="secondary" href={exportHref}>
            Export Center
          </Button>
          <Button as="a" variant="secondary" href={exportPdfHref}>
            PDF inventory
          </Button>
        </div>
        {orgId ? <TeamSettingsNav orgId={orgId} current="data" /> : null}
      </header>

      <OfflineBanner feature="Team Data" fromCache={fromCache} cachedAt={cachedAt} />

      {message ? (
        <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <DataSourceDegradedBanner health={dataSourceHealth} canOpenTeamData />

      {shell === "empty" ? (
        <>
          <EmptyState
            soft
            badge="No cache yet"
            badgeTone="setup"
            title="Sync the active event"
            description={`${activeEventLabel} is selected, but there are no match or ranking rows yet. Sync pulls the official event numbers.`}
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
            Active event: <strong>{activeEventLabel}</strong>
          </p>
          {shownRows(inventory).length === 0 ? (
            <p className="app-muted">Nothing recorded yet. Counts appear once your team scouts or adds research.</p>
          ) : (
            <ul className="team-data-inventory">
              {shownRows(inventory).map((row) => (
                <li key={row.label}>
                  <span>{rowName(row.label)}</span>
                  <strong>{row.count.toLocaleString()}</strong>
                </li>
              ))}
            </ul>
          )}
          <h3>Official event data</h3>
          {reference.length === 0 ? (
            <p className="app-muted">Nothing synced yet. Sync your event to pull its teams, matches and rankings.</p>
          ) : (
            <ul className="team-data-inventory reference">
              {reference.map((row) => (
                <li key={row.label}>
                  <span>{rowName(row.label)}</span>
                  <strong>{row.count.toLocaleString()}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="team-data-side">
          <section className="app-card soft-panel team-data-panel">
            <h2>Event data</h2>
            {/* One status line and one button: "platform key", "fallback credential" and an
                ingestion telemetry block were hosting words on a team's page. */}
            <p className="app-muted">
              {lastRefreshed
                ? `Up to date for ${activeEventLabel} · last refreshed ${lastRefreshed}.`
                : hasActiveEvent
                  ? `Matches, teams and rankings for ${activeEventLabel}.`
                  : "Pick your event on Event day first."}
            </p>
            <Button variant="primary" type="button" disabled={busy || !hasActiveEvent} onClick={() => void syncActiveEvent()}>
              {busy ? "Refreshing…" : "Refresh now"}
            </Button>
          </section>

          <TbaKeyPanel
            required={!tbaConfigured}
            value={key}
            onValueChange={setKey}
            onSubmit={saveFallbackKey}
            busy={busy}
            credentials={credentials}
            onTest={(credentialId) => void testCredential(credentialId)}
            /* The live page already prints save/sync feedback under its header;
               passing it again here would show every result twice. */
            message=""
            ok={ok}
          />

        </aside>
      </div>

      {/* No "Next actions" list here: it repeated the Schedule, Event Day and Strategy links above. */}
    </main>
  );
}
