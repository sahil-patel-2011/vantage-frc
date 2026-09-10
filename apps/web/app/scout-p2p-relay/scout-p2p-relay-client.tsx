"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { relayDeviceRoleLabel, relaySessionStatusLabel } from "../../lib/scout-p2p-relay";
import type { ScoutP2pRelayView } from "../../lib/scout-p2p-relay/compute-scout-p2p-relay";
import type { RelayDeviceRole } from "../../lib/scout-p2p-relay/types";
import { PitMeshPanel } from "./pit-mesh-panel";

const DEVICE_ROLES: RelayDeviceRole[] = ["scout", "captain"];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<ScoutP2pRelayView, { status: "live" }>;

export default function ScoutP2pRelayClient() {
  const [view, setView] = useState<ScoutP2pRelayView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/scout-p2p-relay${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutP2pRelayView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFailureStatus(response.status);
          setFailureMessage("error" in data && data.error ? data.error : "");
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
        const response = await fetch("/api/scout-p2p-relay", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as ScoutP2pRelayView | { error?: string };
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
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Scout P2P Relay"}
          </>
        }
        title="Scout P2P Relay"
        description="Local device-to-device scout sync — BroadcastChannel on this origin, paste envelopes between tablets; the captain uplinks the merged outbox to Vantage."
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
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
              message:
                failureMessage || "A network or server issue prevented loading. Try again.",
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
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <StartSessionForm busy={busy} mutate={mutate} />
          <Sessions view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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
