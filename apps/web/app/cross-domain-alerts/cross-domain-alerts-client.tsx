"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import { SUBSYSTEM_EVENT_DOMAINS, subsystemEventDomainLabel } from "../../lib/cross-domain-alerts";
import type { CrossDomainAlertsView } from "../../lib/cross-domain-alerts/compute-cross-domain-alerts";
import type { CrossDomainAlertSeverity, SubsystemEventDomain } from "../../lib/cross-domain-alerts/types";

const SEVERITY_STYLE: Record<CrossDomainAlertSeverity, { color: string; background: string; label: string }> = {
  critical: { color: "#7a1f1f", background: "#fde2e2", label: "Critical" },
  warning: { color: "#7a5520", background: "#fff1df", label: "Warning" },
  info: { color: "#7a5b16", background: "#fff6d8", label: "Info" },
};

type LiveView = Extract<CrossDomainAlertsView, { status: "live" }>;

export default function CrossDomainAlertsClient() {
  const [view, setView] = useState<CrossDomainAlertsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/cross-domain-alerts${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CrossDomainAlertsView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setErrorStatus(response.status);
          setLoadError("error" in data && data.error ? data.error : "");
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
        const response = await fetch("/api/cross-domain-alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as CrossDomainAlertsView | { error?: string };
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

  // Retry cannot fix an expired session, so the failure decides its own action.
  const failure = fetchFailed
    ? loadFailureCopy(
        classifyLoadFailure({
          status: errorStatus,
          message: loadError,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
        }),
        {
          nextPath:
            typeof window === "undefined"
              ? null
              : `${window.location.pathname}${window.location.search}`,
          message: loadError || "A network or server issue prevented loading. Try again.",
        },
      )
    : null;

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Cross-domain alerts"}
          </>
        }
        title="Cross-domain alerts"
        description="Flags when a CAD/subsystem change lands on a subsystem with an open design review, and firmware/software-version mismatches — computed from what your team has logged."
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
          {orgId ? (
            <>
              <a className="app-button secondary" href={`/design-reviews?orgId=${encodeURIComponent(orgId)}`}>
                Design reviews
              </a>
            </>
          ) : null}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <a className="app-button" href={failure.primary.href}>
              {failure.primary.label}
            </a>
          ) : null}
          {failure.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
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
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <AlertsPanel view={view} busy={busy} mutate={mutate} />
          <LogEventForm busy={busy} mutate={mutate} />
          <RecentEvents view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Open alerts", value: String(summary.totalAlerts) },
    { label: "Critical", value: String(summary.criticalCount) },
    { label: "Warning", value: String(summary.warningCount) },
    { label: "Review conflicts", value: String(summary.reviewConflictCount) },
    { label: "Version mismatches", value: String(summary.versionMismatchCount) },
    { label: "Subsystems affected", value: String(summary.subsystemsAffected) },
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

function AlertsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.alerts.length === 0) {
    return (
      <EmptyState
        badge="All clear"
        badgeTone="good"
        title="No cross-domain conflicts detected"
        description="No logged CAD/subsystem change overlaps an open design review, and no tracked firmware/software version drifts from its target."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Active alerts</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.alerts.map((alert) => {
          const tone = SEVERITY_STYLE[alert.severity];
          return (
            <li
              key={alert.key}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
            >
              <div>
                <span
                  className="app-badge"
                  style={{ color: tone.color, background: tone.background, marginBottom: 4, display: "inline-block" }}
                >
                  {tone.label}
                </span>
                <strong style={{ display: "block" }}>{alert.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {alert.detail}
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "acknowledge-alert", alertKey: alert.key })}
              >
                Acknowledge
              </button>
            </li>
          );
        })}
      </ul>
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
  if (view.events.length === 0) {
    return (
      <EmptyState
        badge="No changes logged yet"
        badgeTone="setup"
        title="Log your first subsystem change"
        description="Logging CAD/firmware/software changes lets Vantage cross-reference them against open design reviews and tracked versions."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Logged subsystem changes</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.events.slice(0, 20).map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              <strong>{item.title}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {item.subsystem} · {subsystemEventDomainLabel(item.domain)} · {new Date(item.occurredAt).toLocaleString()}
              </small>
              {item.description ? <small className="app-muted">{item.description}</small> : null}
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete "${item.title}"?`)) {
                  mutate({ action: "delete-event", eventId: item.id });
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

function LogEventForm({
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
      domain: "cad" as SubsystemEventDomain,
      description: "",
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
          action: "log-event",
          subsystem: form.subsystem,
          title: form.title,
          domain: form.domain,
          description: form.description || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log a subsystem change</h2>
      <FormGrid min={160}>
        <FormRow label="Subsystem">
          <input value={form.subsystem} onChange={set("subsystem")} placeholder="Intake" required />
        </FormRow>
        <FormRow label="Change">
          <input value={form.title} onChange={set("title")} placeholder="Reworked roller mount" required />
        </FormRow>
        <FormRow label="Domain">
          <select value={form.domain} onChange={set("domain")}>
            {SUBSYSTEM_EVENT_DOMAINS.map((domain) => (
              <option key={domain} value={domain}>
                {subsystemEventDomainLabel(domain)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.description} onChange={set("description")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.subsystem.trim() || !form.title.trim()}>
          Log change
        </button>
      </div>
    </Panel>
  );
}
