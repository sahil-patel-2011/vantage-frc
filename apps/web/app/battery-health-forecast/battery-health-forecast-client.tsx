"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { forecastStatusLabel } from "../../lib/battery-health-forecast";
import type { BatteryHealthForecastView } from "../../lib/battery-health-forecast/compute-battery-health-forecast";
import type { ForecastStatus } from "../../lib/battery-health-forecast/types";
import {
  BATTERY_HEALTH_FORECAST_RELATED_INCLUDE,
  batteryHealthForecastNextActions,
  batteryHealthForecastRelatedLinks,
  batteryHealthForecastShellCopy,
  classifyBatteryHealthForecastShell,
  formatBatteryHealthForecastMetric,
  formatBatteryHealthForecastReadiness,
  shouldShowBatteryHealthForecastSummaryTiles,
  type BatteryHealthForecastNextAction,
  type BatteryHealthForecastShellKind,
} from "../../lib/battery-health-forecast/battery-health-forecast-related";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";

function statusTone(status: ForecastStatus): string {
  if (status === "healthy") return "good";
  if (status === "watch") return "setup";
  if (status === "retire_soon" || status === "overdue") return "demo";
  return "setup";
}

function isBatteryHealthForecastView(value: unknown): value is BatteryHealthForecastView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistBatteryHealthForecastSnapshot(
  orgHint: string,
  data: BatteryHealthForecastView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("battery-health-forecast", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("battery-health-forecast", "_", data);
  } catch {
    // Live Pack health already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<BatteryHealthForecastView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function BatteryHealthForecastRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = batteryHealthForecastRelatedLinks(orgId, {
    include: [...BATTERY_HEALTH_FORECAST_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav
      className="product-hub-related battery-health-forecast-related"
      aria-label="Related battery tools"
    >
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function BatteryHealthForecastNextActionsPanel({
  actions,
}: {
  actions: BatteryHealthForecastNextAction[];
}) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions battery-health-forecast-next-actions"
      aria-label="Next actions"
    >
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

function BatteryHealthForecastShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: BatteryHealthForecastShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = batteryHealthForecastNextActions({ orgId, shell });
  const copy = batteryHealthForecastShellCopy(shell);
  const buildHref = withOrgHref("/build", orgId);
  const rotationHref = hubHref("/competition", "battery-rotation", orgId);

  return (
    <main className="module-page battery-health-forecast-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Pack health"}
          </>
        }
        title="Pack health"
        description={description}
      >
        <BatteryHealthForecastRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Needs setup"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No batteries yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {shell === "setup" ? (
          <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={rotationHref}>Open Charge plan</Button>
        ) : null}
      </EmptyState>
      {shell === "ready" ? <BatteryHealthForecastNextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function BatteryHealthForecastClient() {
  const [view, setView] = useState<BatteryHealthForecastView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<BatteryHealthForecastView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<BatteryHealthForecastView>(
          "battery-health-forecast",
          urlOrg || "_",
        );
        if (!viewRef.current && cached?.data && isBatteryHealthForecastView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(
          `/api/battery-health-forecast${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as BatteryHealthForecastView | { error?: string };
        if (!response.ok || !isBatteryHealthForecastView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Pack health. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistBatteryHealthForecastSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Pack health. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const batteryCount = view?.status === "live" ? view.batteries.length : 0;
  const summary = view?.status === "live" ? view.summary : null;
  const scoredPackCount = summary
    ? summary.activeBatteries - summary.insufficientDataCount
    : 0;

  const shell = classifyBatteryHealthForecastShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" ? view.orgId : view?.status === "setup_required" ? view.orgId : null,
    batteryCount,
  });
  const shellCopy = batteryHealthForecastShellCopy(shell);
  const nextActions = batteryHealthForecastNextActions({
    orgId,
    shell,
    batteryCount,
    insufficientDataCount: summary?.insufficientDataCount ?? 0,
    watchCount: summary?.watchCount ?? 0,
    retireSoonCount: summary?.retireSoonCount ?? 0,
    overdueCount: summary?.overdueCount ?? 0,
  });
  const relatedLinks = batteryHealthForecastRelatedLinks(orgId, {
    include: [...BATTERY_HEALTH_FORECAST_RELATED_INCLUDE],
  });
  const buildHref = withOrgHref("/build", orgId);
  const rotationHref = hubHref("/competition", "battery-rotation", orgId);
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const pitHref = withOrgHref("/pit", orgId);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/battery-health-forecast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data = (await response.json()) as BatteryHealthForecastView | { error?: string };
          if (!response.ok || !isBatteryHealthForecastView(data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          void persistBatteryHealthForecastSnapshot(orgId, data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <BatteryHealthForecastShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Pack health" fromCache={fromCache} cachedAt={cachedAt} />
      </BatteryHealthForecastShell>
    );
  }

  if (shell === "error") {
    return (
      <BatteryHealthForecastShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={load}
      >
        <OfflineBanner feature="Pack health" fromCache={fromCache} cachedAt={cachedAt} />
      </BatteryHealthForecastShell>
    );
  }

  if (shell === "setup") {
    return (
      <BatteryHealthForecastShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Pack health" fromCache={fromCache} cachedAt={cachedAt} />
      </BatteryHealthForecastShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <BatteryHealthForecastShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Pack health" fromCache={fromCache} cachedAt={cachedAt} />
      </BatteryHealthForecastShell>
    );
  }

  return (
    <main className="module-page battery-health-forecast-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Pack health"}
          </>
        }
        title="Pack health"
        description="Predict battery end-of-life from cycle count and internal-resistance history. Forecasts use only what you log."
      >
        <div className="battery-health-forecast-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>
      <OfflineBanner feature="Pack health" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <BatteryHealthForecastNextActionsPanel actions={nextActions} />

      {shouldShowBatteryHealthForecastSummaryTiles(batteryCount) ? (
        <FleetSummaryPanel view={view} scoredPackCount={scoredPackCount} />
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No batteries yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <Button as="a" variant="primary" href={rotationHref}>
            Open Charge plan
          </Button>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <AddBatteryForm busy={busy} mutate={mutate} />
        <LogReadingForm view={view} busy={busy} mutate={mutate} />
        {shell === "ready" ? <ForecastTable view={view} busy={busy} mutate={mutate} /> : null}
        <Panel aria-label="Battery health forecast tip">
          <span className="eyebrow">Fleet path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Schedule match packs in <a href={rotationHref}>Charge plan</a>, log IR on{" "}
            <a href={batteriesHref}>Batteries</a>, and check event-day rack status in{" "}
            <a href={pitHref}>Pit Command</a>
          </p>
        </Panel>
      </div>
    </main>
  );
}

function FleetSummaryPanel({
  view,
  scoredPackCount,
}: {
  view: LiveView;
  scoredPackCount: number;
}) {
  const { summary } = view;
  const tiles = [
    { label: "Batteries", value: formatBatteryHealthForecastMetric(summary.totalBatteries, true) },
    { label: "Active", value: formatBatteryHealthForecastMetric(summary.activeBatteries, true) },
    { label: "Retired", value: formatBatteryHealthForecastMetric(summary.retiredBatteries, true) },
    { label: "Watch", value: formatBatteryHealthForecastMetric(summary.watchCount, true) },
    { label: "Retire soon", value: formatBatteryHealthForecastMetric(summary.retireSoonCount, true) },
    { label: "Overdue", value: formatBatteryHealthForecastMetric(summary.overdueCount, true) },
    {
      label: "Fleet readiness",
      value: formatBatteryHealthForecastReadiness(summary.fleetReadiness, true, scoredPackCount),
    },
  ];
  return (
    <section className="battery-health-forecast-stats" aria-label="Real battery forecast counts">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ForecastTable({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  return (
    <Panel id="bhf-forecast">
      <h2 style={{ marginTop: 0 }}>Fleet forecast</h2>
      <div style={{ overflowX: "auto" }}>
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10, margin: 0 }}>
          {view.forecasts.map((forecast) => (
            <li
              key={forecast.batteryId}
              style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}
            >
              <div>
                <span className={`app-badge ${statusTone(forecast.forecastStatus)}`} style={{ marginRight: 8 }}>
                  {forecastStatusLabel(forecast.forecastStatus)}
                </span>
                <strong>{forecast.label}</strong>
                {forecast.serialNumber ? <small className="app-muted"> · {forecast.serialNumber}</small> : null}
                <small className="app-muted" style={{ display: "block" }}>
                  {forecast.readingsCount === 0
                    ? "No IR readings logged yet"
                    : `${forecast.readingsCount} reading(s)${
                        forecast.latestCycleCount != null ? ` · ${forecast.latestCycleCount} cycles` : ""
                      }${
                        forecast.latestResistanceMohm != null
                          ? ` · ${forecast.latestResistanceMohm} mΩ latest`
                          : ""
                      }`}
                </small>
                {forecast.projectedRetirementDate ? (
                  <small className="app-muted" style={{ display: "block" }}>
                    Projected retirement: {forecast.projectedRetirementDate}
                    {forecast.daysRemaining != null ? ` (${forecast.daysRemaining}d)` : ""}
                    {forecast.projectedRetirementCycle != null
                      ? ` · cycle ${forecast.projectedRetirementCycle}`
                      : ""}
                  </small>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                {forecast.status === "active" ? (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "retire-battery", batteryId: forecast.batteryId })}
                  >
                    Retire
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => mutate({ action: "reactivate-battery", batteryId: forecast.batteryId })}
                  >
                    Reactivate
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${forecast.label}"?`)) {
                      mutate({ action: "delete-battery", batteryId: forecast.batteryId });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function AddBatteryForm({ busy, mutate }: { busy: boolean; mutate: Mutate }) {
  const empty = useMemo(() => ({ label: "", serialNumber: "", putInServiceOn: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      id="bhf-add-battery"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.label.trim()) return;
        mutate({
          action: "add-battery",
          label: form.label,
          serialNumber: form.serialNumber || undefined,
          putInServiceOn: form.putInServiceOn || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add battery</h2>
      <FormGrid min={160}>
        <FormRow label="Label">
          <input value={form.label} onChange={set("label")} placeholder="Battery 7" required />
        </FormRow>
        <FormRow label="Serial number (optional)">
          <input value={form.serialNumber} onChange={set("serialNumber")} />
        </FormRow>
        <FormRow label="Put in service (optional)">
          <input type="date" value={form.putInServiceOn} onChange={set("putInServiceOn")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.label.trim()}>
          Add battery
        </Button>
      </div>
    </Panel>
  );
}

function LogReadingForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
}) {
  const activeBatteries = view.batteries.filter((b) => b.status === "active");
  const empty = useMemo(
    () => ({
      batteryId: activeBatteries[0]?.id ?? "",
      cycleCount: "",
      internalResistanceMohm: "",
      voltage: "",
      notes: "",
    }),
    [activeBatteries],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  if (activeBatteries.length === 0) {
    return null;
  }

  return (
    <Panel
      id="bhf-log-reading"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.batteryId || !form.internalResistanceMohm) return;
        mutate({
          action: "log-reading",
          batteryId: form.batteryId,
          cycleCount: Number(form.cycleCount) || 0,
          internalResistanceMohm: Number(form.internalResistanceMohm),
          voltage: form.voltage ? Number(form.voltage) : undefined,
          notes: form.notes || undefined,
        });
        setForm({ ...empty, batteryId: form.batteryId });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Log reading</h2>
      <FormGrid min={160}>
        <FormRow label="Battery">
          <select value={form.batteryId} onChange={set("batteryId")}>
            {activeBatteries.map((battery) => (
              <option key={battery.id} value={battery.id}>
                {battery.label}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Cycle count">
          <input type="number" min={0} value={form.cycleCount} onChange={set("cycleCount")} />
        </FormRow>
        <FormRow label="Internal resistance (mΩ)">
          <input
            type="number"
            min={0}
            step="0.1"
            value={form.internalResistanceMohm}
            onChange={set("internalResistanceMohm")}
            required
          />
        </FormRow>
        <FormRow label="Voltage (optional)">
          <input type="number" min={0} step="0.01" value={form.voltage} onChange={set("voltage")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.batteryId || !form.internalResistanceMohm}>
          Log reading
        </Button>
      </div>
    </Panel>
  );
}
