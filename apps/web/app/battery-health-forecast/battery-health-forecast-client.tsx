"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { forecastStatusLabel } from "../../lib/battery-health-forecast";
import type { BatteryHealthForecastView } from "../../lib/battery-health-forecast/compute-battery-health-forecast";
import type { ForecastStatus } from "../../lib/battery-health-forecast/types";

function statusTone(status: ForecastStatus): string {
  if (status === "healthy") return "good";
  if (status === "watch") return "setup";
  if (status === "retire_soon" || status === "overdue") return "demo";
  return "setup";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<BatteryHealthForecastView, { status: "live" }>;

export default function BatteryHealthForecastClient() {
  const [view, setView] = useState<BatteryHealthForecastView | null>(null);
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

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/battery-health-forecast", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as BatteryHealthForecastView | { error?: string };
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
            <a href={orgId ? `/build?orgId=${encodeURIComponent(orgId)}` : "/build"}>Build</a>
            {" / Battery Health Forecast"}
          </>
        }
        title="Battery Health Forecast"
        description="Predict battery end-of-life from cycle count and internal-resistance history. Forecasts use only what you log — no fabricated numbers."
      >
        {orgId ? (
          <a className="app-button secondary" href={`/battery-rotation?orgId=${encodeURIComponent(orgId)}`}>
            Battery rotation
          </a>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Battery Health Forecast"
          description="A network or server issue prevented loading. Try again."
        >
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
          <FleetSummaryPanel view={view} />
          <AddBatteryForm busy={busy} mutate={mutate} />
          <LogReadingForm view={view} busy={busy} mutate={mutate} />
          <ForecastTable view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function FleetSummaryPanel({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Batteries", value: String(summary.totalBatteries) },
    { label: "Active", value: String(summary.activeBatteries) },
    { label: "Retired", value: String(summary.retiredBatteries) },
    { label: "Watch", value: String(summary.watchCount) },
    { label: "Retire soon", value: String(summary.retireSoonCount) },
    { label: "Overdue", value: String(summary.overdueCount) },
    { label: "Fleet readiness", value: pct(summary.fleetReadiness) },
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

function ForecastTable({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.forecasts.length === 0) {
    return (
      <EmptyState
        badge="No batteries yet"
        badgeTone="setup"
        title="Add a battery to start forecasting"
        description="Add a pack above and log cycle-count and internal-resistance readings to project its end-of-life."
      />
    );
  }
  return (
    <Panel>
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
                  {forecast.readingsCount} reading(s)
                  {forecast.latestCycleCount != null ? ` · ${forecast.latestCycleCount} cycles` : ""}
                  {forecast.latestResistanceMohm != null ? ` · ${forecast.latestResistanceMohm} mΩ latest` : ""}
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

function AddBatteryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ label: "", serialNumber: "", putInServiceOn: "", notes: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
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
  mutate: (payload: Record<string, unknown>) => void;
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
        <button type="submit" className="app-button" disabled={busy || !form.batteryId || !form.internalResistanceMohm}>
          Log reading
        </button>
      </div>
    </Panel>
  );
}
