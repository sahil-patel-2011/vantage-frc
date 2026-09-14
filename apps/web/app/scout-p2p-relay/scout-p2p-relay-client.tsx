"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { relayDeviceRoleLabel, relaySessionStatusLabel } from "../../lib/scout-p2p-relay";
import type { ScoutP2pRelayView } from "../../lib/scout-p2p-relay/compute-scout-p2p-relay";
import type { RelayDeviceRole } from "../../lib/scout-p2p-relay/types";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { PitMeshPanel } from "./pit-mesh-panel";

const DEVICE_ROLES: RelayDeviceRole[] = ["scout", "captain"];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ScoutP2pRelayView, { status: "live" }>;

function isScoutP2pRelayView(value: unknown): value is ScoutP2pRelayView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function responseError(data: unknown): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "";
}

function scoutP2pCacheOrg(data: ScoutP2pRelayView, orgHint: string): string {
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

async function persistScoutP2pSnapshot(
  orgHint: string,
  seasonHint: string,
  data: ScoutP2pRelayView,
): Promise<void> {
  const cacheOrg = scoutP2pCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("scout-p2p-relay", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("scout-p2p-relay", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Pit mesh already painted; IndexedDB is best-effort.
  }
}

function PitMeshRelated({ orgId }: { orgId?: string | null }) {
  return (
    <nav className="product-hub-related" aria-label="Related scouting tools">
      <Button as="a" variant="secondary" href={hubHref("/competition", "scouting", orgId)}>
        Scouting
      </Button>
      <Button as="a" variant="secondary" href={hubHref("/competition", "scout-schema-negotiate", orgId)}>
        Schema sync
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/scouting/lineup", orgId)}>
        Coverage
      </Button>
    </nav>
  );
}

function PitMeshNextActions({ orgId }: { orgId: string }) {
  const actions = [
    {
      id: "start",
      label: "Start a pit session",
      detail: "Open a session so scout tablets can share entries when venue Wi-Fi drops.",
      href: "#pit-mesh-start",
      primary: true,
    },
    {
      id: "scouting",
      label: "Open Scouting",
      detail: "Live match and pit entries are what this mesh merges.",
      href: hubHref("/competition", "scouting", orgId),
      primary: false,
    },
    {
      id: "schema",
      label: "Open Schema sync",
      detail: "Older tablet forms are reconciled here instead of being dropped.",
      href: hubHref("/competition", "scout-schema-negotiate", orgId),
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

export default function ScoutP2pRelayClient() {
  const [view, setView] = useState<ScoutP2pRelayView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ScoutP2pRelayView | null>(null);
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
      const cached = await getFeatureSnapshot<ScoutP2pRelayView>(
        "scout-p2p-relay",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isScoutP2pRelayView(cached.data)) {
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
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(
        `/api/scout-p2p-relay${query.toString() ? `?${query.toString()}` : ""}`,
        {
          cache: "no-store",
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      if (!response.ok || !isScoutP2pRelayView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Pit mesh. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(responseError(data));
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistScoutP2pSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Pit mesh. Showing the last copy on this device.");
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
        const response = await fetch("/api/scout-p2p-relay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isScoutP2pRelayView(data)) {
          setError(responseError(data) || "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistScoutP2pSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const competitionHref = orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition";
  const header = (
    <PageHeader
      breadcrumbs={
        <>
          <a href={competitionHref}>Competition</a>
          {" / Pit mesh"}
        </>
      }
      title="Pit mesh"
      description="Share scout entries between tablets in the pit when venue Wi-Fi is down. Paste a token onto another tablet; the captain tablet sends the merged entries when the network is back."
    >
      <PitMeshRelated orgId={orgId} />
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
            status: failureStatus,
            message: failureMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: failureMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        {header}
        <OfflineBanner feature="Pit mesh" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : "Loading…"}
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
          <OfflineBanner feature="Pit mesh" fromCache={fromCache} cachedAt={cachedAt} />
          {error ? (
            <p className="telemetry-status" role="alert">
              {error}
            </p>
          ) : null}
          <EmptyState badge="Needs setup" badgeTone="setup" title={view.message}>
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
      <OfflineBanner feature="Pit mesh" fromCache={fromCache} cachedAt={cachedAt} />
      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      <PitMeshNextActions orgId={view.orgId} />
      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        <StartSessionForm busy={busy} mutate={mutate} />
        <Sessions view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Sessions", value: String(summary.totalSessions) },
    { label: "Open", value: String(summary.openSessions) },
    { label: "Devices synced", value: String(summary.totalDevices) },
    { label: "Entries merged", value: String(summary.totalEntriesMerged) },
    { label: "Uplink rate", value: pct(summary.uplinkRate) },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
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

function Sessions({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalSessions === 0) {
    return (
      <EmptyState
        badge="No relay sessions yet"
        badgeTone="setup"
        title="Start your first pit relay session"
        description="Open a session before matches so scout tablets can merge entries locally; the captain tablet uplinks once synced."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Relay sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
        {view.sessions.map((sess) => {
          const entries = view.entries.filter((e) => e.sessionId === sess.id);
          return (
            <li key={sess.id} className="app-card soft-panel" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div>
                  <strong>{sess.eventKey}</strong>
                  <small className="app-muted" style={{ display: "block" }}>
                    {relaySessionStatusLabel(sess.status)} · Captain: {sess.captainDeviceLabel}
                  </small>
                  <small className="app-muted">
                    {sess.deviceCount} device(s) · {sess.entriesMerged} entries merged ·{" "}
                    {sess.conflictsResolved} conflicts resolved · {pct(sess.uplinkRate)} uplinked
                  </small>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {sess.status !== "closed" ? (
                    <Button variant="secondary" type="button" disabled={busy} onClick={() => mutate({ action: "update-status", sessionId: sess.id, status: sess.status === "open" ? "synced" : "closed", }) }>
                      {sess.status === "open" ? "Mark synced" : "Close (uplinked)"}
                    </Button>
                  ) : null}
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Delete relay session "${sess.eventKey}"?`)) {
                        mutate({ action: "delete-session", sessionId: sess.id });
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <LogEntryForm sessionId={sess.id} busy={busy} mutate={mutate} />
              {view.orgId ? (
                <PitMeshPanel orgId={view.orgId} session={sess} busy={busy} mutate={mutate} />
              ) : null}
              {entries.length > 0 ? (
                <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 4 }}>
                  {entries.map((entry) => (
                    <li key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span>
                        {entry.deviceLabel} ({relayDeviceRoleLabel(entry.deviceRole)})
                      </span>
                      <small className="app-muted">
                        {entry.entriesContributed} entries · {entry.conflictsResolved} conflicts ·{" "}
                        {entry.uplinked ? "uplinked" : "local only"}
                      </small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function StartSessionForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ eventKey: "", captainDeviceLabel: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="pit-mesh-start"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.eventKey.trim() || !form.captainDeviceLabel.trim()) return;
        mutate({ action: "start-session", eventKey: form.eventKey, captainDeviceLabel: form.captainDeviceLabel });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Start relay session</h2>
      <FormGrid min={160}>
        <FormRow label="Event key">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026test" required />
        </FormRow>
        <FormRow label="Captain device">
          <input value={form.captainDeviceLabel} onChange={set("captainDeviceLabel")} placeholder="Captain iPad" required />
        </FormRow>
      </FormGrid>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.eventKey.trim() || !form.captainDeviceLabel.trim()}>
          Start session
        </Button>
      </div>
    </Panel>
  );
}

function LogEntryForm({
  sessionId,
  busy,
  mutate,
}: {
  sessionId: string;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      deviceLabel: "",
      deviceRole: "scout" as RelayDeviceRole,
      entriesContributed: "",
      conflictsResolved: "",
      uplinked: false,
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.deviceLabel.trim()) return;
        mutate({
          action: "log-entry",
          sessionId,
          deviceLabel: form.deviceLabel,
          deviceRole: form.deviceRole,
          entriesContributed: Number(form.entriesContributed) || 0,
          conflictsResolved: Number(form.conflictsResolved) || 0,
          uplinked: form.uplinked,
        });
        setForm(empty);
      }}
      style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}
    >
      <FormRow label="Device">
        <input value={form.deviceLabel} onChange={set("deviceLabel")} placeholder="Scout Tablet A" required />
      </FormRow>
      <FormRow label="Role">
        <select value={form.deviceRole} onChange={set("deviceRole")}>
          {DEVICE_ROLES.map((role) => (
            <option key={role} value={role}>
              {relayDeviceRoleLabel(role)}
            </option>
          ))}
        </select>
      </FormRow>
      <FormRow label="Entries">
        <input type="number" min={0} value={form.entriesContributed} onChange={set("entriesContributed")} />
      </FormRow>
      <FormRow label="Conflicts">
        <input type="number" min={0} value={form.conflictsResolved} onChange={set("conflictsResolved")} />
      </FormRow>
      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="checkbox"
          checked={form.uplinked}
          onChange={(event) => setForm((prev) => ({ ...prev, uplinked: event.target.checked }))}
        />
        Uplinked
      </label>
      <Button variant="secondary" type="submit" disabled={busy || !form.deviceLabel.trim()}>
        Log merge
      </Button>
    </form>
  );
}
