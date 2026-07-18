"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { hourLogKindLabel } from "../../lib/hours-self-view";
import type { HoursSelfViewView } from "../../lib/hours-self-view/compute-hours-self-view";

type LiveView = Extract<HoursSelfViewView, { status: "live" }>;

function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

export default function HoursSelfViewClient() {
  const [view, setView] = useState<HoursSelfViewView | null>(null);
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
    void fetch(`/api/hours-self-view${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as HoursSelfViewView | { error?: string };
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
        const response = await fetch("/api/hours-self-view", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as HoursSelfViewView | { error?: string };
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
            {" / My Hours"}
          </>
        }
        title="My Hours"
        description="Your own logged shop, meeting, and outreach time — read-only, plus kiosk mode and the biometric consent gate for minors."
      />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState title="Could not load your hours" description="A network or server issue prevented loading. Try again.">
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
          <BiometricGatePanel view={view} busy={busy} mutate={mutate} />
          <KioskPanel view={view} />
          <EntriesList view={view} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Total hours", value: String(summary.totalHours) },
    { label: "Sessions", value: String(summary.totalEntries) },
    { label: "Status", value: summary.openEntry ? "Clocked in" : "Clocked out" },
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
      {summary.byKind.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, marginTop: 12, display: "grid", gap: 6 }}>
          {summary.byKind.map((row) => (
            <li key={row.kind} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{hourLogKindLabel(row.kind)}</span>
              <small className="app-muted">
                {row.entries} session(s) · {row.hours}h
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function BiometricGatePanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { biometricConsent, biometricGate } = view;
  return (
    <Panel aria-label="Biometric consent gate">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${biometricGate.allowed ? "good" : "setup"}`}>
            {biometricGate.allowed ? "BIOMETRICS ALLOWED" : "BIOMETRICS BLOCKED"}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Biometric consent gate</h2>
          <small className="app-muted">{biometricGate.reason}</small>
        </div>
      </header>
      {biometricConsent ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          {biometricConsent.isMinor ? "Minor" : "Adult"} · status: {biometricConsent.status}
          {biometricConsent.guardianName ? ` · guardian: ${biometricConsent.guardianName}` : ""}
        </p>
      ) : (
        <p className="app-muted" style={{ marginTop: 12 }}>No consent record on file yet.</p>
      )}
      {!biometricConsent || biometricConsent.status !== "granted" ? (
        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            className="app-button secondary"
            disabled={busy}
            onClick={() =>
              mutate({
                action: "record-biometric-consent",
                isMinor: true,
                status: "pending",
              })
            }
          >
            Request guardian consent
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function KioskPanel({ view }: { view: LiveView }) {
  if (view.kioskSessions.length === 0) {
    return (
      <EmptyState
        badge="No kiosk devices"
        badgeTone="setup"
        title="No locked kiosk devices registered"
        description="An owner or admin can register a shop-floor kiosk for supervised clock-in/out."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Kiosk devices</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {view.kioskSessions.map((kiosk) => (
          <li key={kiosk.id} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>{kiosk.deviceLabel}</span>
            <small className="app-muted">
              {kiosk.isLocked ? "Locked" : "Unlocked"}
              {kiosk.lastActiveAt ? ` · last active ${fmtDateTime(kiosk.lastActiveAt)}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EntriesList({ view }: { view: LiveView }) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        badge="No hours yet"
        badgeTone="setup"
        title="No logged hours yet"
        description="Clock in from the build-hours module to start building your record."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Recent sessions</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.slice(0, 30).map((entry) => (
          <li key={entry.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
            <div>
              <strong>{hourLogKindLabel(entry.kind)}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {fmtDateTime(entry.clockIn)}
                {entry.clockOut ? ` – ${fmtDateTime(entry.clockOut)}` : " · in progress"}
                {entry.note ? ` · ${entry.note}` : ""}
              </small>
            </div>
            <small className="app-muted">{entry.clockOut ? fmtHours(entry.minutes) : "—"}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
