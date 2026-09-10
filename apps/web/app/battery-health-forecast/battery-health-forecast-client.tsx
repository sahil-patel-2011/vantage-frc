"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { forecastStatusLabel } from "../../lib/battery-health-forecast";
import type { BatteryHealthForecastView } from "../../lib/battery-health-forecast/compute-battery-health-forecast";
import type { ForecastStatus } from "../../lib/battery-health-forecast/types";
import {
  BATTERY_HEALTH_FORECAST_RELATED_INCLUDE,
  batteryHealthForecastNextActions,
  batteryHealthForecastRelatedLinks,
  batteryHealthForecastSetupSteps,
  batteryHealthForecastShellCopy,
  classifyBatteryHealthForecastShell,
  formatBatteryHealthForecastMetric,
  formatBatteryHealthForecastReadiness,
  shouldShowBatteryHealthForecastSummaryTiles,
  type BatteryHealthForecastNextAction,
  type BatteryHealthForecastShellKind,
} from "../../lib/battery-health-forecast/battery-health-forecast-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";

function statusTone(status: ForecastStatus): string {
  if (status === "healthy") return "good";
  if (status === "watch") return "setup";
  if (status === "retire_soon" || status === "overdue") return "demo";
  return "setup";
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
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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
  const batteriesHref = hubHref("/team", "batteries", orgId);
  const pitHref = withOrgHref("/pit", orgId);

  return (
    <main className="module-page battery-health-forecast-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Battery Health Forecast"}
          </>
        }
        title="Battery Health Forecast"
        description={description}
      >
        <BatteryHealthForecastRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
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
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Choose your team
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={rotationHref}>
              Open Battery Rotation
            </a>
            <a className="app-button secondary" href={batteriesHref}>
              Open Batteries
            </a>
            <a className="app-button secondary" href={pitHref}>
              Open Pit Command
            </a>
          </>
        ) : null}
      </EmptyState>
      <BatteryHealthForecastNextActionsPanel actions={actions} />
    </main>
  );
}

export default function BatteryHealthForecastClient() {
  const [view, setView] = useState<BatteryHealthForecastView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/battery-health-forecast${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as BatteryHealthForecastView | { error?: string };
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
  const setupSteps = batteryHealthForecastSetupSteps(orgId);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/battery-health-forecast", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as BatteryHealthForecastView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <BatteryHealthForecastShell description={shellCopy.description} orgId={null} shell="loading" />
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
      />
    );
  }

  if (shell === "setup") {
    return (
      <BatteryHealthForecastShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {(view?.status === "setup_required" ? view.steps : setupSteps).length > 0 ? (
          <ol className="strategy-setup-steps">
            {(view?.status === "setup_required" ? view.steps : setupSteps).map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        ) : null}
      </BatteryHealthForecastShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <BatteryHealthForecastShell description={shellCopy.description} orgId={orgId} shell="setup" />
    );
  }

  return (
    <main className="module-page battery-health-forecast-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Battery Health Forecast"}
          </>
        }
        title="Battery Health Forecast"
        description="Predict battery end-of-life from cycle count and internal-resistance history. Forecasts use only what you log."
      >
        <div className="battery-health-forecast-header-actions">
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

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
          <a className="app-button" href={rotationHref}>
            Open Battery Rotation
          </a>
          <a className="app-button secondary" href={batteriesHref}>
            Open Batteries
          </a>
          <a className="app-button secondary" href={pitHref}>
            Open Pit Command
          </a>
        </EmptyState>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <AddBatteryForm busy={busy} mutate={mutate} />
        <LogReadingForm view={view} busy={busy} mutate={mutate} />
        {shell === "ready" ? <ForecastTable view={view} busy={busy} mutate={mutate} /> : null}
        <Panel aria-label="Battery health forecast tip">
          <span className="eyebrow">Fleet path</span>
          <p className="app-muted" style={{ marginTop: 8 }}>
            Schedule match packs in <a href={rotationHref}>Battery Rotation</a>, log IR on{" "}
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
        <button type="submit" className="app-button" disabled={busy || !form.label.trim()}>
          Add battery
        </button>
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
        <button
          type="submit"
          className="app-button"
          disabled={busy || !form.batteryId || !form.internalResistanceMohm}
        >
          Log reading
        </button>
      </div>
    </Panel>
  );
}
