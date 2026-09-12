"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  Button,
} from "../../components/ui";
import { SUBSYSTEM_EVENT_DOMAINS, subsystemEventDomainLabel } from "../../lib/cross-domain-alerts";
import type { CrossDomainAlertsView } from "../../lib/cross-domain-alerts/compute-cross-domain-alerts";
import type { CrossDomainAlertSeverity, SubsystemEventDomain } from "../../lib/cross-domain-alerts/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

const SEVERITY_TONE: Record<CrossDomainAlertSeverity, { tone: BadgeTone; label: string }> = {
  critical: { tone: "danger", label: "Critical" },
  warning: { tone: "setup", label: "Warning" },
  info: { tone: "neutral", label: "Info" },
};

type LiveView = Extract<CrossDomainAlertsView, { status: "live" }>;

function isCrossDomainAlertsView(value: unknown): value is CrossDomainAlertsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function crossDomainCacheOrg(data: CrossDomainAlertsView, orgHint: string): string {
  if (typeof data.orgId === "string" && data.orgId.trim()) return data.orgId;
  return orgHint;
}

async function persistCrossDomainAlertsSnapshot(
  orgHint: string,
  seasonHint: string,
  data: CrossDomainAlertsView,
): Promise<void> {
  const cacheOrg = crossDomainCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("cross-domain-alerts", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("cross-domain-alerts", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Cross-domain alerts already painted; IndexedDB is best-effort.
  }
}

export default function CrossDomainAlertsClient() {
  const [view, setView] = useState<CrossDomainAlertsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CrossDomainAlertsView | null>(null);
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
      const cached = await getFeatureSnapshot<CrossDomainAlertsView>(
        "cross-domain-alerts",
        orgHint || "_",
        seasonHint,
      );
      if (!viewRef.current && cached?.data && isCrossDomainAlertsView(cached.data)) {
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
    setError("");
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(
        `/api/cross-domain-alerts${query.toString() ? `?${query.toString()}` : ""}`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isCrossDomainAlertsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Cross-domain alerts. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistCrossDomainAlertsSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Cross-domain alerts. Showing the last copy on this device.");
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
        const response = await fetch("/api/cross-domain-alerts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isCrossDomainAlertsView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistCrossDomainAlertsSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const failure =
    fetchFailed && !view
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
          {orgId ? (
            <Button as="a" variant="secondary" href={`/design-reviews?orgId=${encodeURIComponent(orgId)}`}>
              Design reviews
            </Button>
          ) : null}
        </div>
      </PageHeader>

      <OfflineBanner feature="Cross-domain alerts" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {failure ? (
        <EmptyState title={failure.title} description={failure.description}>
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Opening Cross-domain" description="Checking your team." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Needs setup" badgeTone="setup" title="Choose your team" description={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
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
          const severity = SEVERITY_TONE[alert.severity];
          return (
            <li
              key={alert.key}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
            >
              <div>
                <Badge tone={severity.tone}>{severity.label}</Badge>
                <strong style={{ display: "block" }}>{alert.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {alert.detail}
                </small>
              </div>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => mutate({ action: "acknowledge-alert", alertKey: alert.key })}
              >
                Acknowledge
              </Button>
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
        <Button variant="primary" type="submit" disabled={busy || !form.subsystem.trim() || !form.title.trim()}>
          Log change
        </Button>
      </div>
    </Panel>
  );
}
